# YouTube subtitle acquisition and track identity

## Goal

在不移除现有 `timedtext` 响应拦截的前提下，增加 Read Frog 式的主动字幕获取和 POT 回退链，并用稳定的字幕轨道身份避免同视频同语言的人工字幕、ASR 字幕或命名轨道发生缓存碰撞。

这是父任务 `07-18-youtube-subtitle-platform` 的第一个可独立验收子任务。

## Requirements

- 从当前 YouTube 播放器响应中读取并校验 `videoId`、字幕轨道列表和当前选择轨道。
- 优先尝试在轨道 `baseUrl` 上请求 `fmt=json3`；请求失败且判断需要 POT 时再进入受控回退。
- POT 回退依次利用可用的播放器/音轨字幕信息与 Gistlate 已观察到的 YouTube `/api/timedtext` 请求，不无条件反复切换 CC。
- 现有 observe-only `fetch`/XHR 响应拦截仍是可靠输入来源，并可向主动获取层提供已观察 URL/POT。
- 轨道身份至少含 `videoId`、规范化源语言、`kind`、`vssId`；同一轨道的不同获取路径必须归一为同一身份。身份用于选择、去重、迟到响应隔离、诊断和 artifact 元数据，不用于生成多个用户可管理译本。
- 每个视频只选择一个规范轨道，顺序为：目标语言人工字幕（直接显示）→ 与音轨语言一致的人工字幕 → 默认/未命名等其他人工字幕 → 与音轨语言一致的 ASR → 其他可用 ASR。
- 如果 YouTube 后续请求了非规范轨道，不得因此覆盖或中止已经选定的规范轨道翻译。
- 保留 Google ASR `tOffsetMs`、完整语义句所有者和短显示范围映射。
- 人工轨道使用 YouTube 已有 cue 断句作为翻译语义所有者，跳过 ASR 句界恢复；仍可在译文过长时进行不改变语义所有权的显示切分。
- 规范轨道语言与目标语言一致时直接显示，不调用 LLM、不创建翻译用量操作，也不把未发生的翻译写成新 artifact；显示仍受 Gistlate 的字幕模式和样式设置控制。
- 保留现有每个 `videoId + src + tgt` 一个 L1/pool artifact 的布局；规范轨道选择必须在第一次缓存读写前完成，避免人工/ASR 竞态覆盖。
- artifact 记录所选轨道身份与源内容指纹；旧 artifact 继续兼容，发现其原文与当前规范轨道明显不一致时不得静默误用。
- 获取失败必须可观测、可重试，且不得写入空或部分 artifact。

## Acceptance Criteria

- [ ] 未出现 YouTube 字幕网络响应时，可从匹配当前 `videoId` 的播放器数据主动取得原始 JSON3 字幕。
- [ ] 需要 POT 的字幕轨道能够在有限次数、有限时间内完成 POT 获取和重试，或者以明确失败状态结束。
- [ ] 现有网络拦截路径继续工作；同一轨道经主动和被动路径到达时只处理一次。
- [ ] 同视频同语言的人工、ASR、命名轨道具有不同运行时身份，但系统只处理按规则选出的一个规范源轨道。
- [ ] 存在人工字幕时选择人工轨道并不调用 ASR 句界恢复；不存在人工字幕时优先选择与视频音频语言一致的 ASR。
- [ ] 存在目标语言人工字幕时直接显示，DeepSeek 请求数与翻译费用均为零，且不会伪造成功翻译 artifact。
- [ ] 旧格式 pool artifact 仍可安全读取；任何兼容回退都有源内容或轨道身份校验。
- [ ] YouTube 后续加载非规范轨道不会中断、覆盖或污染已选规范轨道及其翻译。
- [ ] SPA 导航的旧播放器响应、旧字幕请求和旧翻译结果不会污染新视频。
- [ ] 获取、选择、去重、POT 回退、轨道切换和缓存兼容有自动测试。
- [ ] 完整测试、编译和单 IIFE 构建约束通过。

## Confirmed Current State

- Gistlate 当前只处理普通 `/watch?v=...`，通过 document-start 的 fetch/XHR observe-only hook 捕获 JSON `timedtext` 响应。
- 当前网络去重键和 `CurrentTrack` 身份只有 `videoId + srcLang`；`kind`、`name`、`vssId` 均未保留。
- L1 key 与 GitHub pool 路径目前都是 `videoId + src + tgt`，因此同语言多轨道会碰撞。
- 当前 `ytInitialPlayerResponse` 只用于视频标题/简介上下文，尚未读取 `captions.playerCaptionsTracklistRenderer.captionTracks`。
- 当前强制重新翻译会覆盖既有 L1/pool artifact，所以轨道身份必须在写入前解决。

## Product Decisions

- 共享 pool 不按 `vssId` 拆分路径。每个视频只保存由确定性优先级选出的一个规范源轨道译本；完整轨道身份保留在运行时和可选 artifact 元数据中。
- 人工字幕优先于任何 ASR，不要求与视频原始音频语言一致。
- 多个人工字幕中，目标语言轨道优先并直接显示；若都需要翻译，音轨同语言人工字幕优先。
- 人工字幕的既有 cue 被视为完整语义单位，只需翻译；ASR 才进行句界恢复。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
- Read Frog research baseline: commit `b14bd0a612909e8cc70932b97b5123a80467faca`.
