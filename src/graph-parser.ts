import path from 'node:path';
import { Parser, Language, type Node } from 'web-tree-sitter';
import { contentHash } from './git.ts';
import type { GraphSymbol, SymbolRange, GraphEdge } from './change-graph.ts';

export interface ParsedReference { name: string; qualifier?: string; kind: GraphEdge['kind']; line: number; member?: boolean }
export interface ParsedImport { name: string; imported: string; source: string }

export interface ParsedSymbol {
  key: string;
  name: string;
  qualifiedName: string;
  owner?: string;
  kind: GraphSymbol['kind'];
  signature: string;
  text: string;
  range: SymbolRange;
  references: ParsedReference[];
  typeName?: string;
  bindings: Record<string, string | undefined>;
}
export interface ParsedFile { symbols: ParsedSymbol[]; imports: ParsedImport[]; hasErrors: boolean; truncated: boolean }

const languages: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.pyi': 'python', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.h': 'cpp', '.hpp': 'cpp', '.hh': 'cpp', '.hxx': 'cpp',
  '.java': 'java', '.cs': 'c_sharp'
};
const loaded = new Map<string, Language>();
const cache = new Map<string, { parsed: ParsedFile; bytes: number }>();
let cacheBytes = 0;
let initialization: Promise<void> | undefined;

export function graphLanguage(filePath: string): string | undefined { return languages[path.extname(filePath).toLowerCase()]; }

export async function parseGraphFile(language: string, text: string): Promise<ParsedFile> {
  const cacheKey = `${language}:${contentHash(text)}`, cached = cache.get(cacheKey);
  if (cached) { cache.delete(cacheKey); cache.set(cacheKey, cached); return cached.parsed; }
  await (initialization ??= Parser.init({ locateFile: () => path.join(__dirname, 'parsers', 'web-tree-sitter.wasm') }));
  let grammar = loaded.get(language);
  if (!grammar) { grammar = await Language.load(path.join(__dirname, 'parsers', `tree-sitter-${language}.wasm`)); loaded.set(language, grammar); }
  const parser = new Parser();
  parser.setLanguage(grammar);
  const deadline = Date.now() + 1000;
  const tree = parser.parse(text, undefined, { progressCallback: () => Date.now() > deadline });
  if (!tree) { parser.delete(); throw new Error('Parsing exceeded its time limit.'); }
  const symbols: ParsedSymbol[] = [];
  const imports: ParsedImport[] = [];
  let truncated = false;
  function visit(node: Node, owner?: ParsedSymbol, namespace = ''): void {
    if (symbols.length >= 20_000) { truncated = true; return; }
    if (node.type === 'decorator') return;
    if (['namespace_definition', 'namespace_declaration', 'internal_module'].includes(node.type)) {
      const scope = node.childForFieldName('name')?.text.replace(/::/g, '.');
      if (scope) namespace = namespace ? `${namespace}.${scope}` : scope;
    }
    if (node.type === 'import_statement') {
      const source = node.childForFieldName('source')?.text.slice(1, -1);
      if (source) for (const specifier of descendants(node, 'import_specifier')) {
        const imported = specifier.childForFieldName('name')?.text, alias = specifier.childForFieldName('alias')?.text;
        if (imported) imports.push({ name: alias ?? imported, imported, source });
      }
    }
    let declarator = node.childForFieldName('declarator');
    const functionDeclarator = declarator?.type === 'function_declarator';
    while (declarator?.childForFieldName('declarator')) declarator = declarator.childForFieldName('declarator');
    let name = node.childForFieldName('name') ?? (node.type === 'assignment' ? node.childForFieldName('left') : node.type === 'field_definition' ? node.childForFieldName('property') : declarator);
    const value = node.childForFieldName('value') ?? node.childForFieldName('right');
    const functionValue = value && ['arrow_function', 'function_expression'].includes(value.type);
    const body = node.childForFieldName('body') ?? (functionValue ? value.childForFieldName('body') : null);
    let kind: GraphSymbol['kind'] | undefined;
    if (['class_declaration', 'class_definition', 'class_specifier', 'struct_specifier'].includes(node.type)) kind = 'class';
    else if (node.type === 'interface_declaration') kind = 'interface';
    else if (['function_declaration', 'function_definition', 'method_definition', 'method_signature', 'method_declaration', 'constructor_declaration'].includes(node.type)) kind = owner?.kind === 'class' || owner?.kind === 'interface' ? 'method' : 'function';
    else if (['public_field_definition', 'field_definition', 'property_signature', 'property_declaration'].includes(node.type) && owner) kind = functionValue ? 'method' : 'field';
    else if (node.type === 'assignment' && owner?.kind === 'class' && name?.type === 'identifier') kind = 'field';
    else if (node.type === 'field_declaration' && owner && language === 'cpp') kind = functionDeclarator ? 'method' : 'field';
    else if (node.type === 'variable_declarator' && owner?.kind === 'class') kind = 'field';
    else if (node.type === 'variable_declarator' && functionValue) kind = 'function';
    if (language === 'python' && node.type === 'assignment' && owner?.name === '__init__' && name?.type === 'attribute' && name.childForFieldName('object')?.text === 'self') {
      const ownerKey = owner.owner;
      const classOwner = symbols.find(symbol => symbol.key === ownerKey);
      const attribute = name.childForFieldName('attribute');
      if (classOwner && attribute && !symbols.some(symbol => symbol.owner === classOwner.key && symbol.name === attribute.text)) { owner = classOwner; name = attribute; kind = 'field'; }
    }
    let current = owner;
    if (kind && name) {
      const declaration = node.parent?.type === 'decorated_definition' ? node.parent : node;
      const end = body?.startIndex ?? (kind === 'field' ? value?.startIndex : undefined) ?? node.endIndex;
      const qualified = name.text.replace(/::/g, '.');
      current = {
        key: `${owner?.key ?? namespace}/${kind}:${name.text}`, name: qualified.split('.').pop()!,
        qualifiedName: owner ? `${owner.qualifiedName}.${qualified}` : namespace ? `${namespace}.${qualified}` : qualified, owner: owner?.key,
        kind, signature: text.slice(declaration.startIndex, end).replace(/[=;\s]+$/, '').replace(/\s+/g, ' ').trim(),
        text: declaration.text, range: { startLine: declaration.startPosition.row + 1, endLine: node.endPosition.row + (node.endPosition.column > 0 ? 1 : 0) }, references: [], bindings: {}
      };
      symbols.push(current);
      const type = node.childForFieldName('type') ?? node.parent?.childForFieldName('type');
      if (kind === 'field' && type) current.typeName = typeNames(type)[0];
      if (kind === 'field' && node.type === 'variable_declarator' && ['java', 'c_sharp'].includes(language)) {
        let declaration = node.parent;
        while (declaration && declaration.type !== 'field_declaration') declaration = declaration.parent;
        if (declaration) {
          const first = descendants(declaration, 'variable_declarator')[0];
          const prefix = text.slice(declaration.startIndex, first.startIndex);
          current.text = `${prefix}\0${node.text}`;
          current.signature = `${prefix}${node.text.split('=')[0]}`.replace(/\s+/g, ' ').trim();
          current.range.startLine = declaration.startPosition.row + 1;
        }
      }
      for (const parameter of (node.childForFieldName('parameters') ?? value?.childForFieldName('parameters'))?.namedChildren ?? []) {
        const parameterName = parameter.childForFieldName('name') ?? parameter.childForFieldName('pattern') ?? parameter.childForFieldName('declarator') ?? (parameter.type === 'identifier' ? parameter : parameter.namedChildren.find(child => child.type === 'identifier'));
        if (parameterName) current.bindings[parameterName.text] = parameter.childForFieldName('type') ? typeNames(parameter.childForFieldName('type')!)[0] : undefined;
      }
      const returnType = node.childForFieldName('return_type') ?? node.childForFieldName('returns') ?? (kind !== 'class' && kind !== 'interface' ? node.childForFieldName('type') : null);
      if (returnType) for (const typeName of typeNames(returnType)) current.references.push({ name: typeName, kind: kind === 'field' ? 'references' : 'returns', line: returnType.startPosition.row + 1 });
      if (kind === 'class' || kind === 'interface') {
        for (const heritage of node.namedChildren.filter(child => ['class_heritage', 'superclass', 'super_interfaces', 'base_class_clause', 'base_list', 'extends_type_clause'].includes(child.type))) {
          const clauses = heritage.type === 'class_heritage' ? heritage.namedChildren : [heritage];
          for (const clause of clauses) for (const typeName of typeNames(clause)) current.references.push({ name: typeName, kind: clause.type.includes('implements') || clause.type === 'super_interfaces' ? 'implements' : 'extends', line: clause.startPosition.row + 1 });
        }
        const superclass = node.childForFieldName('superclasses');
        if (superclass) for (const typeName of typeNames(superclass)) current.references.push({ name: typeName, kind: 'extends', line: superclass.startPosition.row + 1 });
      }
    }
    if (current && ['method', 'function'].includes(current.kind) && node.type === 'variable_declarator' && name && !functionValue) {
      const type = node.childForFieldName('type');
      current.bindings[name.text] = type ? typeNames(type)[0] : undefined;
    }
    if (current && ['call_expression', 'call', 'method_invocation', 'invocation_expression', 'new_expression', 'object_creation_expression'].includes(node.type)) {
      const called = node.childForFieldName('function') ?? node.childForFieldName('constructor') ?? node.childForFieldName('type');
      const member = called?.childForFieldName('property') ?? called?.childForFieldName('field') ?? called?.childForFieldName('attribute') ?? called?.childForFieldName('name') ?? node.childForFieldName('name');
      const object = called?.childForFieldName('object') ?? called?.childForFieldName('argument') ?? called?.childForFieldName('expression') ?? called?.childForFieldName('scope') ?? node.childForFieldName('object');
      if (member || called) current.references.push({ name: (member ?? called)!.text, qualifier: object?.text, kind: 'calls', line: node.startPosition.row + 1 });
    }
    if (current && ['method', 'function'].includes(current.kind) && ['member_expression', 'attribute', 'field_expression', 'member_access_expression'].includes(node.type)) {
      const member = node.childForFieldName('property') ?? node.childForFieldName('attribute') ?? node.childForFieldName('field') ?? node.childForFieldName('name');
      const object = node.childForFieldName('object') ?? node.childForFieldName('argument') ?? node.childForFieldName('expression');
      if (member && object && node.parent?.childForFieldName('function')?.id !== node.id) current.references.push({ name: member.text, qualifier: object.text, kind: 'references', member: true, line: node.startPosition.row + 1 });
    }
    for (const child of node.namedChildren) visit(child, current, namespace);
  }
  try {
    visit(tree.rootNode);
    const parsed = { symbols, imports, hasErrors: tree.rootNode.hasError, truncated };
    const bytes = text.length * 2 + symbols.reduce((total, symbol) => total + symbol.text.length * 2 + symbol.signature.length * 2 + symbol.references.length * 100 + 300, 0);
    if (bytes <= 16 * 1024 * 1024) {
      cache.set(cacheKey, { parsed, bytes }); cacheBytes += bytes;
      while (cache.size > 64 || cacheBytes > 16 * 1024 * 1024) { const key = cache.keys().next().value!; cacheBytes -= cache.get(key)!.bytes; cache.delete(key); }
    }
    return parsed;
  }
  finally { tree.delete(); parser.delete(); }
}

function descendants(node: Node, type: string): Node[] {
  return node.type === type ? [node] : node.namedChildren.flatMap(child => descendants(child, type));
}

function typeNames(node: Node): string[] {
  if (['type_identifier', 'identifier'].includes(node.type)) return [node.text];
  return [...new Set(node.namedChildren.flatMap(typeNames))];
}
