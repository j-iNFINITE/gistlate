# YouTube subtitle platform enhancements

## Goal

吸收 Read Frog 在 YouTube 字幕主动获取、字幕轨道识别、播放器内字幕渲染与用户设置方面的成熟机制，提高 Gistlate 获取字幕的成功率，避免同语言不同轨道互相污染，并让双语字幕更易读、更可控。

项目仍以“辅助观看 YouTube 视频”为核心：翻译必须按完整语义句生成，再映射到短时显示范围；不能为追求即时显示而退回到独立翻译残句。

## Workstreams

### A. 字幕主动获取与轨道身份

- 在现有 YouTube 响应拦截之外，增加从播放器数据读取字幕轨道并主动获取 JSON3 的路径。
- 当主动请求需要 YouTube POT 时，允许通过启用字幕、读取音轨字幕元数据或观察 YouTube 自身 `timedtext` 请求获得 POT，再重试主动获取。
- 为字幕轨道建立稳定身份，至少考虑 `videoId`、`languageCode`、`kind`、`vssId`，并定义其与本地缓存、共享 pool artifact 和生成元数据的关系。
- 识别 YouTube 后续加载或切换的字幕轨道，但只处理按产品优先级选出的规范轨道，防止非规范轨道覆盖当前结果。

### B. 渲染与设置增强

- 研究并选择性吸收 Read Frog 的播放器内字幕覆盖层和设置能力。
- 候选能力包括：字幕启停、原文/译文/双语模式、原译文上下顺序、两种文字的独立字体设置、背景样式、可调整并记忆的位置、自动启动、RTL 与语言属性、原文及译文字幕下载、加载/错误状态、播放器控制栏显隐适配。
- 本任务只支持普通 YouTube Watch 页面；不得未经验证照搬 Read Frog 的 React、Jotai、WXT 或扩展后台架构。

## Requirements

- 保留当前响应拦截路径，主动读取播放器数据作为快速路径或回退路径，不形成单点依赖。
- 保留现有 Google ASR `tOffsetMs` 解析、完整语义句所有者、短显示范围映射及完整 artifact 原子保存机制。
- 保留每个视频的实际 DeepSeek token 用量与费用记录，以及本地所有历史尝试累计。
- 继续输出 Tampermonkey 单 IIFE，不引入动态 `import()` 或 SystemJS。
- 遵守当前 Trusted Types/DOM 安全约束；不使用 `innerHTML` 拼装 UI。
- 兼容已有 `{s,d,o,t}` pool artifact；新轨道身份不能静默破坏旧字幕备份。
- 不把 Read Frog 为显示而裁短的残句直接作为翻译语义所有者。
- 新设置必须有明确默认值、持久化行为和旧配置迁移策略。
- 获取、轨道切换、缓存命中、渲染及设置行为应有与风险相称的自动测试。

## Acceptance Criteria

- [ ] 已有响应拦截仍可获取并翻译当前支持的 YouTube 字幕。
- [ ] 当响应拦截没有及时提供字幕时，系统能从校验过 `videoId` 的播放器响应取得轨道并主动请求 JSON3。
- [ ] 需要 POT 的视频能通过受控回退链重试；失败时给出可理解状态且不污染缓存。
- [ ] 同一视频、同一语言的人类字幕与 ASR 字幕不会错误复用彼此的源字幕或翻译缓存。
- [ ] YouTube 后续加载或切换到非规范轨道时，Gistlate 能识别但不会让它覆盖当前规范轨道、翻译任务或缓存。
- [ ] 翻译仍以完整语义句为单位，显示切片不造成残句翻译或时间轴重叠。
- [ ] 最终确定的渲染与设置 MVP 在播放器内可操作、可持久化，并有兼容默认值。
- [ ] 字幕覆盖层能正确设置 `lang`/`dir`，且不会遮挡播放器控制栏或因控制栏显隐发生明显跳动。
- [ ] 若纳入下载功能，原文和译文均能导出带合法时间轴的字幕文件。
- [ ] `pnpm test`、`pnpm compile`、`pnpm build` 通过，构建结果保持单 IIFE、无 SystemJS、无动态导入。

## Confirmed Evidence

- Read Frog 审查基于提交 `b14bd0a612909e8cc70932b97b5123a80467faca`。
- Read Frog 的主动获取链为：播放器 `baseUrl` 直取 JSON3；失败后等待播放器状态、启用 CC 触发 POT，优先读音轨字幕元数据中的 `pot/potc`，必要时观察 YouTube 自身 `/api/timedtext` URL，再携带 POT 重试。
- Read Frog 的轨道哈希为 `videoId:languageCode:kind:vssId`，并优先使用播放器当前选择的 `vssId`。
- Read Frog 支持 watch、embed、Shorts、Shadow DOM 覆盖层、位置拖动、双语模式、独立字体、背景透明度、自动启动、下载和 RTL 等设置。
- Read Frog 的短显示片段独立翻译不适合 Gistlate；真实视频 `Ru7H092hFAI` 中曾形成不完整日语语义片段。
- Gistlate 已在上一任务中建立 `169` 个完整语义所有者到约 `242` 个显示范围的分离模型，应继续作为翻译与渲染边界。
- 当前 Gistlate 已有双语/仅译文、原译文独立字号与颜色、共享字体/字重、描边、背景透明度、底部偏移、行间距、实时样式预览，以及播放器控制栏显隐避让；规划将聚焦缺失能力，不重复实现。
- 旧拖动方案失败是因为字幕文字本身处于 YouTube 点击捕获层之下；Read Frog 的独立 grip handle 提供了可适配的解决路径。
- 当前所有字幕、L1 和 pool 身份均只到 `videoId + language`，确实存在同语言人工/ASR/命名轨道碰撞风险。

## Out of Scope Unless Explicitly Added

- 术语表自动提取或术语管理。
- 放弃完整视频 artifact，改成只有临时逐句缓存。
- 把 Gistlate 重写为 React/WXT 浏览器扩展。
- 完全替换现有 YouTube 响应拦截机制。
- YouTube Embed 与 Shorts 页面适配。

## Open Product Decisions

- 无。

## Product Decisions

- 每个视频正常只维护一个规范源轨道，不向用户暴露多轨道 artifact 管理。
- 人工字幕优先，不要求人工字幕与视频原始音频语言一致；没有人工字幕时才选择与视频同语言的 ASR。
- 人工字幕存在目标语言轨道时，优先直接显示该轨道，不调用 LLM；若所有人工字幕都需要翻译，则优先选择与音轨语言一致的人工轨道。
- 人工字幕视为已经完成语义断句，只进行翻译和必要的显示映射；ASR 才进入基于 `tOffsetMs`/标点的句界恢复流程。
- 运行时仍保留轨道身份用于选择、去重、迟到响应隔离和诊断。
- L1 与共享 pool 继续保持每个 `videoId + src + tgt` 一个规范译本，不因 `vssId` 拆出多个共享文件。
- 本任务仅覆盖普通 `/watch?v=...` 页面；Embed 与 Shorts 均不纳入本轮。
- 渲染/设置首版纳入三种显示模式、原译文顺序、独立字体样式、背景/描边/间距、独立拖动手柄、位置记忆、控制栏/全屏/尺寸适配、`lang/dir`、播放器内启停与设置入口、默认开启的自动启动，以及完整加载/错误状态。
- 原文与译文 SRT 下载不在本任务实现，后移到 `07-18-stored-subtitle-browser`。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
- Read Frog 仅作为设计参考；实现必须适配 Gistlate 的 Tampermonkey 单脚本架构和现有数据契约。
