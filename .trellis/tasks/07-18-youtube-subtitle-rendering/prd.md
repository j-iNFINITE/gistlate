# YouTube subtitle rendering and settings

## Goal

在 Gistlate 现有轻量 DOM 覆盖层和实时样式面板上，吸收 Read Frog 中真正改善观看体验的渲染、播放器支持和设置能力，而不引入 React/WXT 重写或破坏单 IIFE、Trusted Types 安全约束。

这是父任务 `07-18-youtube-subtitle-platform` 的第二个可独立验收子任务。

## Requirements

- 保留 `createElement`/`textContent` 构建 UI、CSS 变量实时预览和 GM 设置持久化。
- 在现有 `bilingual`、`translation-only` 之外补齐 `original-only`，并支持双语时译文在原文上方或下方。
- 将当前共享的 `fontFamily` 与 `fontWeight` 拆为原文/译文可独立配置；保留各自字号和颜色，并进行旧设置无损迁移。
- 保留并完善背景透明度、描边/阴影、行间距和播放器控制栏避让。
- 用独立、高层级拖动手柄实现垂直拖动；位置使用 `{anchor: top|bottom, percent}` 持久化，并在尺寸变化或控制栏出现时保持可见。
- 对源语言和目标语言分别设置正确的 `lang`/`dir`；支持 RTL 语言。
- 增加播放器内的启停入口和设置入口，避免核心观看操作只能从 Tampermonkey 菜单访问。
- 增加自动启动开关，默认开启以保持旧行为；关闭时只挂载控制入口，不得自动启用 CC、获取或翻译，用户可手动启动当前视频。
- 只支持普通 watch 页面；Embed 与 Shorts 不进入本任务。
- 状态 UI 明确区分等待字幕、获取、翻译进度、完成和错误，不用永久遮挡视频。

## Acceptance Criteria

- [ ] 可在双语、仅原文、仅译文三种模式间切换，且等待翻译时不出现空屏。
- [ ] 双语模式可切换译文在上/下，切换即时生效并持久化。
- [ ] 原文与译文可以独立设置字体族、字号、颜色和字重；旧设置迁移后视觉效果接近当前版本。
- [ ] 背景透明度、描边、间距和位置均可实时预览、保存、重置。
- [ ] 字幕可通过独立拖动手柄纵向移动；播放器视频区域的普通点击仍可播放/暂停，位置跨刷新保持。
- [ ] 控制栏显隐、播放器大小变化和全屏切换不会把字幕推离可见区域。
- [ ] 源/译文元素有正确 `lang` 与 `dir`，RTL 目标语言渲染方向正确。
- [ ] 播放器内可启停 Gistlate 并打开设置；禁用时恢复 YouTube 原生字幕可见性。
- [ ] 自动启动默认开启；关闭后不产生自动字幕获取或 LLM 请求，手动启动只作用于当前视频会话。
- [ ] 普通 YouTube Watch 页面通过真实视频、SPA 导航和全屏场景手工验收。
- [ ] 自动测试、编译和单 IIFE 构建约束通过。

## Confirmed Current State

- 现有覆盖层已经支持双语/仅译文、原译文独立字号与颜色、共享字体族/字重、描边、背景透明度、底部偏移、行间距和控制栏显隐避让。
- 现有样式面板已支持实时预览、保存、重置和关闭时回滚；播放器控制栏旁已有 `Aa` 入口。
- 现有覆盖层没有 `original-only`、原译文顺序、独立字体族/字重、`lang/dir`、启停、自动启动或下载。
- 旧的拖动尝试因直接拖字幕内容被 YouTube 点击捕获层拦截而撤销；Read Frog 使用覆盖层中独立且高层级的 grip handle，正好规避该失败模式。
- 现有 `getVideoId()` 和播放器选择器只支持 watch 页面；embed/Shorts 需要独立页面模式与生命周期。

## Product Decisions

- 本任务只支持普通 YouTube Watch 页面；Embed 与 Shorts 后移且当前不创建实现子任务。
- 首版纳入三种显示模式、原译文顺序、独立字体样式、背景/描边/间距、独立拖动手柄、位置记忆、播放器避让/全屏/尺寸适配、`lang/dir`、播放器内启停与设置入口、默认开启的自动启动，以及完整状态反馈。
- 原文/译文 SRT 下载移入 `07-18-stored-subtitle-browser`，本任务不实现下载 UI 或导出逻辑。

## Open Product Decisions

- 无。

## Out of Scope

- YouTube Embed 与 Shorts。
- 原文/译文 SRT 下载；由储存字幕浏览器任务统一处理。
- React、Jotai、WXT 或整套 Read Frog UI 架构迁移。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
- 不照搬 Read Frog 的 React/Jotai/Shadow DOM；仅吸收其数据模型、交互模式和平台适配经验。
