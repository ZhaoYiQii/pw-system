// 诚实占位：该根命令对应的能力尚未由任何已授权 Slice 实现。
// 只输出原因并返回非 0，禁止伪装成功。
const [name, slice] = process.argv.slice(2);
console.error(
  `[not-implemented] "${name}" 尚无实现。按计划在 ${slice ?? "后续 Slice"} 提供真实实现与验收；当前不得声称该能力可用。`
);
process.exit(1);
