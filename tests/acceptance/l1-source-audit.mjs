// Read-only inventory. A literal count is not a claim of semantic coverage.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const root = 'apps/web/src';
const files = fs.readdirSync(root, { recursive: true }).filter(file => /\.tsx?$/.test(file) && !file.includes('.test.') && !file.startsWith('test') && !file.startsWith('i18n'));
const report = [];
for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const literals = [];
  function visit(node) {
    if ((ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && /[\u3400-\u9fff]/u.test(node.text ?? '')) {
      literals.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: node.text.trim() });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (literals.length) report.push({ file, count: literals.length, literals });
}
console.log(JSON.stringify({ total: report.reduce((sum, file) => sum + file.count, 0), files: report }, null, 2));
