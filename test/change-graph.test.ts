import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildChangeGraph } from '../src/change-graph.ts';
import { contentHash, type FileSnapshot } from '../src/git.ts';

function file(path: string, before: string, after: string): FileSnapshot {
  return { path, before, after, beforeHash: contentHash(before), afterHash: contentHash(after), status: !before ? 'added' : !after ? 'deleted' : 'modified', binary: false };
}

test('summarizes class member edits with exact per-member and class line counts', async () => {
  const before = 'export class Cart {\n  total(): number {\n    return 1;\n  }\n  gone() { return 0; }\n}\nexport function unchanged() { return 1; }\n';
  const after = before.replace('return 1;\n', 'return 2;\n').replace('gone() { return 0; }', 'added() { return 3; }');
  const graph = await buildChangeGraph({ id: 'snapshot', files: [file('cart.ts', before, after)] });
  const cart = graph.symbols.find(symbol => symbol.name === 'Cart');
  assert.ok(cart, 'The changed class is represented');
  assert.deepEqual(cart.changes, { added: 2, removed: 2 });
  const total = graph.symbols.find(symbol => symbol.name === 'total')!;
  assert.equal(total.parentId, cart.id);
  assert.equal(total.status, 'modified');
  assert.deepEqual(total.changes, { added: 1, removed: 1 });
  assert.equal(total.after?.startLine, 2);
  assert.equal(graph.symbols.find(symbol => symbol.name === 'gone')?.status, 'deleted');
  assert.equal(graph.symbols.find(symbol => symbol.name === 'added')?.status, 'added');
  assert.equal(graph.symbols.find(symbol => symbol.name === 'unchanged')?.status, 'unchanged');
});

test('extracts Python class fields, methods and standalone functions', async () => {
  const source = 'class Cart:\n    count: int = 1\n    def total(self) -> int:\n        return self.count\n\ndef checkout():\n    return Cart()\n';
  const graph = await buildChangeGraph({ id: 'python', files: [file('cart.py', '', source)] });
  assert.deepEqual(graph.symbols.map(symbol => [symbol.name, symbol.kind]), [['Cart', 'class'], ['count', 'field'], ['total', 'method'], ['checkout', 'function']]);
  assert.equal(graph.symbols.find(symbol => symbol.name === 'total')?.after?.startLine, 3);
  assert.deepEqual(graph.symbols.find(symbol => symbol.name === 'Cart')?.changes, { added: 4, removed: 0 });
});

test('extracts C++ class members and free functions without treating calls as declarations', async () => {
  const source = 'class Cart {\n  int count = 1;\npublic:\n  int total() const { return count; }\n};\nint checkout() { Cart cart; return cart.total(); }\n';
  const graph = await buildChangeGraph({ id: 'cpp', files: [file('cart.cpp', '', source)] });
  assert.deepEqual(graph.symbols.map(symbol => [symbol.name, symbol.kind]), [['Cart', 'class'], ['count', 'field'], ['total', 'method'], ['checkout', 'function']]);
  assert.deepEqual(graph.symbols.find(symbol => symbol.name === 'total')?.changes, { added: 1, removed: 0 });
});

test('extracts Java fields, constructors and methods', async () => {
  const source = 'class Cart {\n  private int count = 1;\n  public Cart() {}\n  public int total() { return count; }\n}\n';
  const graph = await buildChangeGraph({ id: 'java', files: [file('Cart.java', '', source)] });
  assert.deepEqual(graph.symbols.map(symbol => [symbol.name, symbol.kind]), [['Cart', 'class'], ['count', 'field'], ['Cart', 'method'], ['total', 'method']]);
});

test('extracts C# fields, properties and methods', async () => {
  const source = 'class Cart {\n  private int count = 1;\n  public int Count { get; set; }\n  public int Total() { return count; }\n}\n';
  const graph = await buildChangeGraph({ id: 'csharp', files: [file('Cart.cs', '', source)] });
  assert.deepEqual(graph.symbols.map(symbol => [symbol.name, symbol.kind]), [['Cart', 'class'], ['count', 'field'], ['Count', 'field'], ['Total', 'method']]);
});

test('extracts JavaScript arrow functions and class field functions', async () => {
  const source = 'export const checkout = (n) => n + 1;\nclass Cart {\n  count = 1;\n  total = () => this.count;\n}\n';
  const graph = await buildChangeGraph({ id: 'js', files: [file('cart.js', '', source)] });
  assert.deepEqual(graph.symbols.map(symbol => [symbol.name, symbol.kind]), [['checkout', 'function'], ['Cart', 'class'], ['count', 'field'], ['total', 'method']]);
});

test('links calls and return types on both snapshots with added usages identified', async () => {
  const before = 'class Receipt {}\nfunction format(n: number) { return String(n); }\nclass Checkout {\n  fee() { return 1; }\n  submit(): Receipt { this.fee(); return new Receipt(); }\n}\n';
  const graph = await buildChangeGraph({ id: 'usages', files: [file('checkout.ts', before, before.replace('this.fee();', 'this.fee(); format(1);'))] });
  const symbol = (name: string) => graph.symbols.find(symbol => symbol.name === name)!;
  const calls = graph.edges.filter(edge => edge.source === symbol('submit').id && edge.kind === 'calls');
  assert.ok(calls.some(edge => edge.target === symbol('fee').id && edge.status === 'unchanged'));
  assert.ok(calls.some(edge => edge.target === symbol('format').id && edge.status === 'added' && edge.after?.line === 5));
  assert.ok(graph.edges.some(edge => edge.source === symbol('submit').id && edge.target === symbol('Receipt').id && edge.kind === 'returns'));
});

test('resolves imported typed receivers without guessing unknown receivers or shadowed functions', async () => {
  const files = [file('gateway.ts', '', 'export class Gateway { charge() {} }\n'), file('checkout.ts', '', 'import { Gateway as Payments } from "./gateway";\nfunction format() {}\nclass Checkout {\n  gateway: Payments;\n  submit(other: unknown, format: Function) { this.gateway.charge(); other.charge(); format(); }\n}\n')];
  const graph = await buildChangeGraph({ id: 'imports', files });
  const calls = graph.edges.filter(edge => edge.kind === 'calls');
  assert.equal(calls.length, 1, 'Only the typed imported receiver can be resolved');
  assert.equal(graph.symbols.find(symbol => symbol.id === calls[0].target)?.qualifiedName, 'Gateway.charge');
});

test('links inheritance and declared field types', async () => {
  const source = 'interface Gateway { charge(): void; }\nclass Base {}\nclass Checkout extends Base { gateway: Gateway; }\n';
  const graph = await buildChangeGraph({ id: 'types', files: [file('checkout.ts', '', source)] });
  const byId = new Map(graph.symbols.map(symbol => [symbol.id, symbol.name]));
  assert.ok(graph.edges.some(edge => byId.get(edge.source) === 'Checkout' && byId.get(edge.target) === 'Base' && edge.kind === 'extends'));
  assert.ok(graph.edges.some(edge => byId.get(edge.source) === 'gateway' && byId.get(edge.target) === 'Gateway' && edge.kind === 'references'));
});

test('retains unchanged callers of a modified class field', async () => {
  const before = 'class Counter {\n  value = 1;\n  read() { return this.value; }\n}\n';
  const graph = await buildChangeGraph({ id: 'field', files: [file('counter.ts', before, before.replace('= 1', '= 2'))] });
  const fieldSymbol = graph.symbols.find(symbol => symbol.name === 'value')!;
  const reader = graph.symbols.find(symbol => symbol.name === 'read')!;
  assert.equal(reader.status, 'unchanged');
  assert.ok(graph.edges.some(edge => edge.source === reader.id && edge.target === fieldSymbol.id && edge.kind === 'references' && edge.status === 'unchanged'));
});

test('keeps unsupported, omitted and edits outside symbols accessible as other changes', async () => {
  const omitted = { ...file('large.ts', '', ''), omitted: 'Text preview exceeds 512 KiB.' };
  const graph = await buildChangeGraph({ id: 'other', files: [file('settings.json', '{}\n', '{"enabled":true}\n'), file('imports.ts', '', 'import { thing } from "external";\n'), omitted] });
  assert.deepEqual(graph.files[0].otherChanges, { added: 1, removed: 1 });
  assert.match(graph.files[0].notice!, /not supported/);
  assert.deepEqual(graph.files[1].otherChanges, { added: 1, removed: 0 });
  assert.equal(graph.files[2].changes, null);
  assert.match(graph.files[2].notice!, /512 KiB/);
});

test('offers graph comments only for available text snapshots, including unsupported languages', async () => {
  const graph = await buildChangeGraph({ id: 'commentable', files: [
    file('settings.json', '{}\n', '{"enabled":true}\n'),
    { ...file('image.bin', '', ''), binary: true },
    { ...file('large.ts', '', ''), omitted: 'Text preview exceeds 512 KiB.' }
  ] });
  assert.deepEqual(graph.files.map(file => [file.path, file.commentable]), [['settings.json', true], ['image.bin', false], ['large.ts', false]]);
});

test('does not attribute a neighbouring edit to an unchanged member on the same line', async () => {
  const before = 'class Counter { value = 1; read() { return this.value; } }\n';
  const graph = await buildChangeGraph({ id: 'same-line', files: [file('counter.ts', before, before.replace('= 1', '= 2'))] });
  assert.deepEqual(graph.symbols.find(symbol => symbol.name === 'read')?.changes, { added: 0, removed: 0 });
  assert.deepEqual(graph.symbols.find(symbol => symbol.name === 'Counter')?.changes, { added: 1, removed: 1 });
});

test('recognizes a Java field type change even when its declarator text stays identical', async () => {
  const before = 'class Cart {\n  private int count = 1;\n}\n';
  const graph = await buildChangeGraph({ id: 'field-type', files: [file('Cart.java', before, before.replace('int count', 'long count'))] });
  const count = graph.symbols.find(symbol => symbol.name === 'count')!;
  assert.equal(count.status, 'modified');
  assert.match(count.signature, /long/);
  assert.deepEqual(count.changes, { added: 1, removed: 1 });
});

test('connects C++ out-of-line method definitions to their captured class across files', async () => {
  const header = 'namespace shop { class Cart { public: int total() const; }; }\n';
  const body = 'namespace shop { int Cart::total() const { return 1; } }\n';
  const graph = await buildChangeGraph({ id: 'cpp-members', files: [file('cart.hpp', header, header.replace('public:', 'public: int count;')), file('cart.cpp', body, body.replace('return 1', 'return 2'))] });
  const cart = graph.symbols.find(symbol => symbol.kind === 'class')!;
  const definition = graph.symbols.find(symbol => symbol.filePath === 'cart.cpp')!;
  assert.equal(definition.kind, 'method');
  assert.equal(definition.qualifiedName, 'shop.Cart.total');
  assert.equal(definition.parentId, cart.id);
  assert.deepEqual(cart.changes, { added: 2, removed: 2 });
});

test('recognizes Java field visibility changes in the containing declaration', async () => {
  const before = 'class Cart {\n  private int count = 1;\n}\n';
  const graph = await buildChangeGraph({ id: 'visibility', files: [file('Cart.java', before, before.replace('private', 'public'))] });
  const count = graph.symbols.find(symbol => symbol.name === 'count')!;
  assert.equal(count.status, 'modified');
  assert.match(count.signature, /public/);
});

test('counts out-of-line definitions on a shared physical line once in their class total', async () => {
  const before = 'class Cart { public: int first(); int second(); };\nint Cart::first() { return 1; } int Cart::second() { return 1; }\n';
  const graph = await buildChangeGraph({ id: 'cpp-shared-line', files: [file('cart.cpp', before, before.replaceAll('return 1', 'return 2'))] });
  const cart = graph.symbols.find(symbol => symbol.kind === 'class')!;
  assert.equal(cart.status, 'modified');
  assert.deepEqual(cart.changes, { added: 1, removed: 1 });
});

test('includes Python decorators in method changes and navigation ranges', async () => {
  const before = 'class Cart:\n    @staticmethod\n    def make(cls):\n        return 1\n';
  const graph = await buildChangeGraph({ id: 'decorators', files: [file('cart.py', before, before.replace('@staticmethod', '@classmethod'))] });
  const method = graph.symbols.find(symbol => symbol.name === 'make')!;
  assert.equal(method.status, 'modified');
  assert.equal(method.after?.startLine, 2);
  assert.deepEqual(method.changes, { added: 1, removed: 1 });
});

test('extracts Python instance fields declared in the constructor and links their readers', async () => {
  const before = 'class Cart:\n    def __init__(self):\n        self.value = 1\n    def read(self):\n        return self.value\n';
  const graph = await buildChangeGraph({ id: 'instance-fields', files: [file('cart.py', before, before.replace('= 1', '= 2'))] });
  const field = graph.symbols.find(symbol => symbol.kind === 'field' && symbol.name === 'value');
  assert.ok(field);
  assert.equal(field.qualifiedName, 'Cart.value');
  assert.equal(field.status, 'modified');
  assert.ok(graph.edges.some(edge => edge.target === field.id && graph.symbols.find(symbol => symbol.id === edge.source)?.name === 'read'));
});

test('retains file-mode-only changes when no symbol text changed', async () => {
  const source = 'function unchanged() {}\n';
  const snapshot = { ...file('script.ts', source, source), beforeMode: '100644', afterMode: '100755' };
  const graph = await buildChangeGraph({ id: 'mode', files: [snapshot] });
  assert.match(graph.files[0].notice!, /100644.*100755/);
  assert.deepEqual(graph.files[0].changes, { added: 0, removed: 0 });
});

test('keeps removed usage links anchored to the original call site', async () => {
  const before = 'function helper() { return 1; }\nfunction caller() { return helper(); }\n';
  const graph = await buildChangeGraph({ id: 'removed-usage', files: [file('calls.ts', before, before.replace('return helper();', 'return 0;'))] });
  const edge = graph.edges.find(edge => edge.kind === 'calls')!;
  assert.equal(edge.status, 'deleted');
  assert.deepEqual(edge.before, { filePath: 'calls.ts', line: 2 });
  assert.equal(edge.after, undefined);
});
