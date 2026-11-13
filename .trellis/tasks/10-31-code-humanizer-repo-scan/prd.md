# code-humanizer 全仓库扫描

## Goal

使用 code-humanizer 技能对整个仓库进行 Mode A 扫描(只报告不修改):识别 AI 代码痕迹(重复造轮子、投机抽象、防御性垃圾、噪音、测试垃圾),输出按模式分组的报告与修复顺序建议。

## Requirements

## Requirements

- 执行 Mode A(扫描 → 报告,不修改任何代码):
  1. 先跑测试套件,记录通过状态与覆盖情况(oracle check)。
  2. 建立仓库现有 helper/抽象索引(支撑"重复造轮子"识别)。
  3. 按 code-humanizer 模式目录(Tier 1-5)逐模块扫描。
  4. 每条发现:模式编号 · 文件:行 · 严重度(0-4)· 证据 · 建议修复 · 行为风险。
- 报告按模式分组,列出豁免项及理由,最后给出修复顺序建议。
- 不进入 Mode B,除非用户明确批准。

## Acceptance Criteria

- [ ] 测试套件状态已记录
- [ ] 全部源码模块扫描完毕
- [ ] 发现报告输出(含严重度、证据、行为风险)
- [ ] 豁免项与理由列出
- [ ] 修复顺序建议给出
## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
