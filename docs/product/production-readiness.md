# Elygate 生产发布验收

检查日期：2026-11-01。状态：**PARTIAL / 不可据此批准生产切换**。

本清单承接 [产品规划](elygate-smb-ai-gateway-roadmap-zh.md) 的原始范围，
不以本次已实现的功能重新定义完成标准。新系统只兼容 Bifrost 上游契约，
不增加旧 Elygate 兼容层；独立 `panel/` 不替换为上游 `ui/`。

## 2026-11-01 模型目录元数据收口

后续项 `model-governance-annotations`，parent 为
`native-production-readiness-resume`，source 为用户“不使用 pi agent 继续”，
reason 为完成既定模型目录元数据编辑。范围冻结为模型目录 helper、定向测试、
页面、翻译和本节文档；Native、低风险、root 单 writer、external=0。
不扩展到策略发布、数据库迁移或生产部署，不调用 Pi 或替代 agent runtime。

面板模型目录已补齐结构化的 `additional_attributes` 维护入口：区域
(`region`)、数据等级 (`data_class`)、能力 (`capabilities`) 和人工健康标注
(`health`)。这些字段只保存目录元数据，不会伪装成区域、数据等级、能力或健康
策略强制；企业枚举和请求拦截仍属于未完成范围。原有描述、自定义属性（包括
原型命名键）会在编辑、清空和重新打开时保留，结构化字段不会与自定义行重复。
本轮证据为 Panel 418 项测试 / 2510 断言、模型目录定向 17 项测试、Svelte
检查 0 错误 0 警告、生产构建成功，以及 1440px 和 375px 暗色/减弱动画浏览器
验收（保存、重载、清空、失败反馈、Tab/Shift+Tab、Escape 焦点恢复、无页面
横向溢出）。浏览器使用测试夹具与 API 请求拦截验证面板交互和真实请求体，
没有连接实际管理后端，因此不证明真实存储持久化或认证。这属于本地
`PASS_SCOPED`，不替代真实供应商、生产凭据、策略强制、Docker 卷恢复或生产切换证据。
代价：仅管理面板编辑/渲染时处理属性，没有推理请求路径或常驻服务端内存增量，
因此不新增推理基准；服务端仍使用上游目录更新 API，没有新存储或兼容层。

## 当前执行状态与剩余门禁

### 2026-11-01 同候选真实恢复 CI

后续项 `single-node-recovery-ci`：parent 为 `9edd2ca54`，source 为生产交付门 7，
reason 为本机 Docker 短探针仍超时，但现有 CI runner 已能实际启动候选容器。
范围冻结为恢复 smoke、Panel workflow、构建契约和本节证据；Native、中风险、
root 单 writer、复用一次独立只读 verifier，不调用 Pi，不修改生产备份/恢复逻辑，
不发布 registry、不改变生产服务或路由发布授权。

新增 Node 内置库恢复入口，在现有镜像 smoke 之后、候选归档之前运行，绑定同一
`IMAGE_ID` / `IMAGE_COMMIT`；失败不允许导出 verified candidate。由本地 OCI
manifest 给候选命名，输入 Docker identity 可严格匹配唯一 manifest digest 或
config digest（两者不混淆），加载后再校验 `.Id` 与输入 identity 完全相等；
不启动 registry 或外部 push。
两个随机 Compose project 使用独立卷、网络、容器及私有 `0700/0600` 文件，
继承环境中的 Compose、备份目录和凭据覆盖被清除。源网关正常停止后实际调用
生产 backup；目标网关保持未启动、runtime 显式禁止 Docker copy-up，由生产
restore 检查空库/空卷并执行导入。目标第一次启动前对比全部业务表和 sequences
逻辑指纹，以及 runtime marker 的 SHA-256、UID/GID、权限和加密凭据。

同一隔离 HTTP fixture 分别接收真实 Relay 和 OpenAI-compatible 推理请求：
Relay 核验解密后 credential、Application Key、日志费用/令牌；
推理请求核验 Usage Ledger 的项目、应用、Key 归属和令牌。
现有 Ledger 只投影 LLM 日志，不能把 Relay 日志伪称 Ledger 记录。
恢复后核验登录/退出、原 Key、原审计 feed、完整签名链与公钥，继续写入用量和
签名事件，再证明源端表、sequences 和 marker 未变。日志不输出 subprocess
原文、SQL 数据、HTTP body、secret 或备份；最终成功必须晚于清理和残留资源检查。

本地构建契约 43 pass / 0 fail（281 assertions）、Node 语法、actionlint 和
diff 检查通过。它们不是 Docker 恢复证据；该入口仍需推送后同 SHA CI 真正执行。
首次候选 `b441fe7cc58a7a1ef40d834674b4f2ff94af6423` 的 run `41245840468`
中 Panel、员工门户和 API contracts 成功，现有镜像 smoke 成功；新增恢复在
candidate identity 阶段失败，导出及归档被跳过。日志明确 Docker 29 `.Id`
是 manifest digest `5d7d51f81ec125f1dda444c262c0f347985f9af950700eb7d646f3bb13b5a557`，
config digest 则为 `05824d96f3f446a677692c0439b09c85c05b3f5f51a91592735cd318af04335f`。
修正为识别两种严格匹配的身份并保留原始 OCI 校验、唯一候选、加载后 `.Id`
一致性检查；不重建 manifest、不改变生产逻辑或放宽恢复断言。仍需新 SHA 运行。
第二次候选 `937f733ab` 的 run `41247155420` 中三个非 Docker job 全部成功，
身份与现有镜像 smoke 已通过，恢复进入源端启动阶段后失败，候选导出/归档未执行。
诊断确认 `docker compose create` 不支持 `--no-deps`；源/目标两处改用
`--no-recreate`，保持数据库容器不被重建且网关未启动。新增固定 phase 标签
用于不泄密定位，并加入 CLI 参数契约；仍须新 SHA 的真实恢复证明。
本机旧镜像诊断（绕过 OCI 重导入，仅用于定位）进一步越过网关创建，确认
Docker copy 的测试文件保留宿主 `501:20`；root helper 丢弃全部 capability 后
只有 `CHOWN`，无法 chmod 非自己所有的文件。仅隔离测试 helper 增加 `FOWNER`，
保留无网络、只读根文件系统和专用卷；不更改生产 entrypoint 或恢复逻辑。
候选 `a540df135` 的 run `41249451522` 中三个非 Docker job、镜像身份和
现有镜像 smoke 均成功；恢复已通过文件准备、网关启动、登录和真实 Relay，
在源端 `/v1/chat/completions` 失败，导出/归档被阻止。代码核对发现新建
Application Key 默认拒绝所有供应商，夹具此前只授予 Relay，遗漏模型授权。
仅测试 Key 增加 `openai` / `gpt-4o-mini` 与该唯一配置供应商的密钥授权，
不打开全部供应商、不改变生产默认拒绝规则；补执行级请求体回归。尚需新 SHA
的完整真实恢复结果，不能将此原因判断记为恢复通过。
候选 `1f3aefbec` 的 run `41250300253` 已通过真实推理和业务持久化，但在生产
备份/隔离恢复阶段因 shell 子步骤失败而停止，候选导出/归档仍被阻止。下一轮
增加固定 backup、target startup/create、restore 和恢复前完整性阶段标签；
只转述可信脚本中原有固定 `fail` 字面量且 stderr 完整行精确匹配的错误，
动态插值和任意子进程输出继续抑制，不改生产脚本或放宽安全门禁。
`7e76525e0` 的 run `41251387910` 三个非 Docker job 和 image smoke 均成功，
精确失败为 `production backup: source containers changed during backup`。
后续项 `single-node-snapshot-ordering`：parent 为 `single-node-recovery-ci`，
source 为上述真实 CI 失败，reason 为修正已复现的等价挂载顺序误报；范围冻结为
backup/restore 两处快照、对应 shell 回归和本节，Native、中风险、root 单 writer、
复用既有只读 verifier。不部署、不发布、不执行生产备份或恢复。
后续诊断发现容器快照直接比较 Docker 返回的 `Mounts` 数组，等价挂载顺序变化
会误报 `source containers changed during backup`。仅在 backup/restore 快照函数中
按挂载目标排序，保留挂载内容、容器身份、镜像、环境、生命周期、健康和 OOM/重启
检查；新增 fake-Docker 顺序变化和真实挂载变更拒绝回归。原快照已实际在新增
顺序变化测试中失败，修正后整套 shell 回归、ShellCheck、43 项 Panel 契约和
diff 检查通过；真实 CI 恢复仍待新 SHA，不放宽源端不变或目标隔离断言。
代价：仅离线备份/恢复的两次 inspect 结果排序，无推理路径或常驻内存增量。
`ab09617a2` 的 run `41252559705` 三个非 Docker job 和 image smoke 均成功，
已越过真实推理、持久化及生产备份；恢复在
`isolated restore: target runtime volume is not empty` 失败，候选导出/归档被阻止。
后续项 `single-node-busybox-enumeration`：parent 为 `single-node-snapshot-ordering`，
source 为上述真实 CI 失败，reason 为修复候选 Alpine 镜像目录枚举命令不支持的
选项；范围冻结为 restore 空卷检查、对应 shell 回归及本节。Native、中风险、
root 单 writer、一次独立只读 verifier；不调用 Pi，不发布或部署生产。
本机既有候选镜像实际复现 BusyBox `ls` 不支持 `-q`，原 `ls -Aq` 无法判断空卷；
不能把该命令错误解释为已发现目标数据。改为镜像支持的 `find`，对每个直接子项
输出固定 sentinel，枚举失败仍拒绝；空卷才允许继续，不删除或忽略已有内容。
回归通过真实目录覆盖普通、隐藏和仅换行文件名，并保留枚举失败拒绝与无导入
写入断言；fake `ls` 明确模拟 BusyBox 不支持选项。整套 shell 回归、ShellCheck、
43 项 Panel 契约（281 assertions）、diff 检查通过；本机既有候选镜像执行同一
新检查，验证空卷通过且上述三类非空卷均拒绝，临时探针已清理。独立 verifier
为 `PASS_SCOPED`。这些证据不是新候选完整恢复成功，仍须新 SHA 的真实 CI。
代价：仅离线恢复前枚举直接子项，无推理请求路径或常驻服务端内存增量。
`43692468c` 的 run `41254064881` 已通过三个非 Docker job、镜像身份、
现有运行时 smoke 和生产备份；新空卷检查也通过，但在恢复后首次启动前完整性
检查阶段失败，候选导出/归档仍被阻止。该次日志只显示固定阶段和脱敏的
`docker command failed`，无法证明数据库、runtime marker 或加密存储哪一项已通过。
后续项 `single-node-recovery-prestart-phases`：parent 为
`single-node-busybox-enumeration`，source 为上述真实 CI 失败，reason 为将既有
恢复前完整性检查拆成固定子阶段以定位真实失败；范围冻结为 smoke 阶段标签、
对应契约测试和本节，不放宽任何完整性断言，不输出 subprocess 原文或 secret，
不调用 Pi，不发布或部署生产。
代价：仅 CI 恢复脚本增加固定诊断标签，无推理请求路径或常驻服务端内存增量。
`a543ad30b` 的 run `41255183717` 三个非 Docker job 均成功；恢复已通过目标
停机状态和数据库指纹，在 `restored pre-start runtime marker` 失败。
后续项 `single-node-runtime-archive-ownership`：parent 为
`single-node-recovery-prestart-phases`，source 为该次真实 CI 失败，reason 为
修复 stdin tar 导入时的 UID/GID 改写。范围冻结为恢复脚本、专项回归与本记录，
Native、中风险、root 单 writer、复用一次独立只读 verifier；不调用 Pi，
不增加 capability、不放宽归档/空卷/隔离门禁，不发布或部署生产。
去掉 `docker cp -a -` 的 `-a`，由归档保留原始所有者，不做统一 `chown`。
fake-Docker 专项验证参数和 tar 输入的 marker `1000:0:600`，不冒充实际解包证明。
本机 Docker 29.8.2 真实探针对比两种参数：旧参数将 `1000:0` 和 `1001:42`
都改为 `0:0`；新参数分别保留两者，`0600/0640` 与 mtime 也保持不变。
此为元数据断言的局部证据：首轮进程因清理失败退出 1，随后按本轮明确名称
确认容器/卷已删除；补跑在 Docker create 超时，未重获完整进程成功，不计通过。
专项回归、ShellCheck、43 项构建契约（284 assertions）、Node 语法和 diff
检查通过；独立复核为 `PASS_SCOPED`。仍须新 SHA 的真实完整恢复 CI，
本次探针不替代业务恢复、registry、升级回滚和生产切换验收。
代价：仅离线恢复的 Docker 导入选项变化，无推理路径或常驻内存增量。
既有 `9edd2ca54` 的 run `41242882512` 已于 2026-10-31 21:26:31 UTC
（北京时间 2026-11-01 05:26:31）全部成功，但没有执行本新增恢复步骤。
本项只有 CI 测试耗时和测试进程的临时内存/磁盘，无推理生产路径或常驻内存增量。
真实供应商、升级回滚、正式发布、策略发布和最终生产切换继续未验收，
原总目标保持 **active / PARTIAL**。

### 2026-11-01 隔离卷恢复演练结果

后续项 `single-node-docker-recovery`，parent 为 `model-governance-annotations`，
source 为用户“不使用 pi agent 继续”，reason 为 Docker 恢复后验证既定单机卷恢复
边界。Native、root 单 owner、测试与证据整理，不修改业务实现，不发布镜像或部署
生产。本后续项以本机运行时阻塞记为 `blocked / PARTIAL`，不启动无限重试。

使用 CI 已验证的候选 `6dd8128632acec8d24108ad71b3d9c7ab2c1c443`（镜像
`sha256:4d0da2801ae7a59c23f8202561af1913708de735ec65188a7956ee80c163066d`）
在 `/Volumes/Datas/.codex-tmp/` 准备了随机项目名、独立 PostgreSQL 卷、只读配置
挂载和 `0700/0600` 私有文件。`single-node-preflight.test.sh` 与
`single-node-backup.test.sh` 全部通过；真实演练也通过了私有 Compose 预检。
随后本机 OrbStack 在 `docker compose up --wait` 阶段出现超时/延迟：PostgreSQL
容器最终启动且日志报告可接受连接，但 Compose 调用未在 120 秒窗口内返回；
清理 Compose 调用同样超时，改为按本轮明确名称删除并核对。未进入真实
`pg_dump`、备份发布或恢复导入。临时项目、容器、卷、网络及私有凭据已清理；
这次结果记为
`PARTIAL`，不能证明整机卷恢复、恢复后登录、Application Key、Usage Ledger、
Audit 或源环境不变。报告保留在本机临时目录
`/Volumes/Datas/.codex-tmp/elygate-recovery-6dd812863/report.json`，不进入提交。

2026-11-01 用户明确要求“不使用 pi agent 继续”，并重申持续完善功能、
准备上线生产环境。当前执行恢复为 **active / PARTIAL**：root 使用 Native
模式、单 writer 继续，不再调用 Pi，也不以恢复 Pi 服务作为实施前提。
此前 `Connection error`、无产出与 TCP 超时仅保留为历史失败证据；
不切换 provider 或修改 Pi 配置、凭据，不把本次恢复解释为功能交付或生产批准。

后续项 `native-production-readiness-resume`：parent 为
`webhook-audit-postgres-race`，source 为上述人工恢复指令，reason 为取消 Pi
依赖后继续收口现有 webhook CI 接入和准确的验收状态。范围冻结为当前五个
已修改文件及其针对性验证；Native、低风险、root 单 writer、external=0。
不扩展业务行为、部署范围或远端写入权限，不以该窄后续项缩减原总目标。
策略发布仍等待用户确认首版单实例 stop-before-start 约束，不能从自动续行消息
推断批准；现有 release API 仍仅为只读，不开放发布/回滚写路由。

该后续项启动时 Docker daemon 不可用；截至本次隔离演练，`orbstack` context 的
Docker Server `29.8.2` 已可响应并成功加载候选镜像，但本地容器启动/清理超时，
不能据此关闭恢复验收。正式制品发布、真实供应商、整机恢复/升级回滚和生产切换
仍未验收；生产目标、窗口、回滚负责人及授权必须另外确认。原始发布/Shadow/
回滚、模型治理、MCP 审批与完整审计范围不缩减，不用额外局部校验替代功能实现。
本后续项开始时五个文件尚未提交，提交推送按用户此前明确要求进行，只包含
这五个文件。新提交 `91f183438` 的 run `41229428442` 已实际执行新专项；
此前额外 vet 和重复 CI 复跑曾中止
（退出 130），不计通过或代码失败；此前成功证据保留。
取消 Pi 后原样复跑 workflow 的 webhook 命令，handlers `1.476s`、
controlplane `8.734s` 均通过且没有空筛选；面板构建契约 31 项、
216 个断言通过，actionlint、gofmt 和 diff 检查通过。
本后续项仅涉及测试、CI 和文档，无 wire-visible 行为变更，豁免新增
provider-harness case；无推理路径或常驻内存增量。

## 候选版本

- 当前完成 CI 的代码候选为 `9edd2ca547fe9164a8d4d9fb41e92e3f765f1b86`，
  run `41242882512` 的 Panel、员工门户、API contracts 和生产镜像四个 job
  全部成功；新增员工事务审计关联专项已实际执行。镜像完成非 root、
  双 PostgreSQL、health、版本、登录/退出、正常重启及候选归档，
  不是新增真实卷恢复、registry 发布或生产切换证明。
- 此前完成 CI 的代码候选为 `6dd8128632acec8d24108ad71b3d9c7ab2c1c443`，
  run `41238139793` 于 2026-10-31 20:16:36 UTC 创建，20:25:29 UTC
  全部成功完成（北京时间 2026-11-01 04:25:29）；Panel、员工门户、
  API contracts 和镜像构建/运行四个 job 全部通过。artifact ID
  `13055788696` 的候选归档已独立下载、通过 `SHA256SUMS`，并成功加载到
  本机 Docker。归档 SHA-256 为
  `30cd24df8e1b3da221574ce945e388c36c251fde2314a2923d1d6820373295fe`；
  来源清单绑定上述源码 SHA、`linux/amd64`，镜像 ID 为
  `sha256:4d0da2801ae7a59c23f8202561af1913708de735ec65188a7956ee80c163066d`，
  镜像用户为 `1000:0`。本机整套恢复未通过，详见上节；没有正式 registry
  发布或生产部署。后续文档提交 `487de76a2` 不属于该镜像的源码身份；
  其未触发 Panel workflow，不能记为又一份通过 CI 的代码候选。
- 此前完成 CI 的代码候选为 `db031515121a34a9f638a96e7cbfb67e5b4e014e`，
  run `41233788107` 于 2026-10-31 19:20:53 UTC 创建，19:30:04 UTC 成功完成
  （北京时间 2026-11-01 03:30:04）；面板、员工门户、API contracts 和镜像
  构建/运行四个 job 全部成功。生产预检步骤实际执行备份/恢复专项，
  不代表真实 Docker 卷恢复。候选 artifact ID 为 `13055087290`，
  上传包大小 `162921963` 字节，于 2026-11-07 19:28:34 UTC 过期；
  runner 使用的镜像 ID 为
  `sha256:a884b719b9fcfb8713763188fa1d8ca908c691347ea4539f3f8ca4b5d3a449fa`。
  本轮仅核对 CI 日志和 artifact 元数据，未独立下载或运行此归档，
  未发布 registry 或部署生产；后续文档提交不是该镜像的来源 SHA。
- 此前完成 CI 的代码候选为 `91f183438fe62fa3b8df442502219d4a47c3caaf`，
  run `41229428442` 于 2026-10-31 18:26:28 UTC 创建，18:32:55 UTC 成功完成
  （北京时间 2026-11-01 02:32:55）；面板、员工门户、API contracts 和镜像
  构建/运行四个 job 全部成功。webhook 专项实际执行 handlers `0.485s`、
  controlplane `9.489s`，无 `[no tests to run]`。候选 artifact ID 为
  `13052628406`，上传包大小 `162921745` 字节，于 2026-11-07 18:32:25 UTC
  过期；未独立下载或运行此归档，未发布 registry 或部署生产。本次仅回填
  验收记录的后续文档提交不是该镜像的来源 SHA。
- 此前完成 CI 的代码候选为 `3e6b1f6098a14bae8723e7aa68f7e69fda51148d`，
  run `41222969336` 于 2026-10-31 17:07:22 UTC 创建，最后于
  17:16:11 UTC 完成；面板、员工门户、API contracts 和镜像构建/运行四个 job
  均成功。候选 artifact ID 为 `13050728318`，上传包大小 `162921569`
  字节，于 2026-11-07 17:13:32 UTC 过期；未独立下载或运行此归档，
  未发布 registry 或部署生产。该 SHA 的既有筛选不执行新增 webhook 审计专项；
  下方本地 `webhook-audit-ci` 补丁不属于该候选或该 run。
- 此前完成 CI 的代码候选为 `4d421b50bd9438f82a8e6b76879be3c2ef430edc`，
  run `41219185774` 于 2026-10-31 16:20:12 UTC 创建，四个 job 均成功，
  最后于 16:28:42 UTC 完成。候选 artifact ID 为 `13050025192`，
  上传包大小 `162918331` 字节，于 2026-11-07 16:27:12 UTC 过期。
  该 run 已包含单机备份专项；未独立下载或运行此归档，未发布 registry
  或部署生产。
- 此前完成 CI 的代码候选为 `486a272b3d7585158f8be5049787debe3bb6017d`，
  run `41217564331` 于 2026-10-31 16:00:44 UTC 创建，最后一个 job
  于 16:09:46 UTC 成功结束（北京时间 2026-11-01 00:09:46）。
  面板、员工门户、API contracts、生产镜像四个 job 均为 success。
  候选 artifact ID 为 `13047943735`，上传包大小 `162919376` 字节，
  预计于 2026-11-07 16:07:34 UTC 过期。本轮仅核对 CI 和 artifact 元数据，
  未独立下载或运行该镜像，未发布 registry 或部署生产。
  此 SHA 包含备份脚本，但其 CI 尚未执行新增备份专项；下方本地
  `single-node-backup-ci` 接入不属于该 SHA 或该 run 的已验证范围。
- 此前完成 CI 的代码候选为 `7bc4b770c06e36cf4b5d720ec6eae8be863011c2`，
  run `41212521367` 于 2026-10-31 14:57:29 UTC 启动、
  15:05:43 UTC 成功结束，四个 job 全部成功。新增 Relay 删除审计专项
  实际执行 handlers（`0.049s`）和 controlplane（`3.906s`），没有
  `[no tests to run]`。manifest digest 为
  `sha256:7486ce8dc3f39be119a029a17560567dc30c848960e7dc8ced178d4debb4575b`；
  镜像非 root、双 PostgreSQL、health、版本、登录/退出、正常重启及清理
  均通过，未发布 registry 或部署生产。artifact ID 为 `13047575404`，
  上传包大小 `162918888` 字节，预计于 2026-11-07 15:04:06 UTC 过期。
  后续仅记录验收结果的文档提交不属于该已运行镜像的来源 SHA。
- 此前已验证候选为 `37479df3fa95a5efa68088816db20978a9cd41e7`，
  CI run `41209424680` 于 2026-10-31 14:17:17 UTC 启动、
  14:23:26 UTC 成功结束，四个 job 均通过。镜像运行检查为非 root、
  双 PostgreSQL、health、版本、登录/退出及正常重启，不是生产部署。
  manifest digest 为
  `sha256:3ce8fbfdc273f416ea1247acf1ad78beb4b0d0621d0af0afbc6fadc08710f2ad`；
  artifact ID 为 `13045709186`，上传包大小 `162919783` 字节，
  预计于 2026-11-07 14:22:54 UTC 过期。独立归档校验见下方
  `relay-log-audit-ci` 后续项；该候选的 CI 尚未执行新增 Relay 删除审计专项，
  本地 workflow 补丁不包含在该 SHA、该次 run 或镜像中。
- 此前已验证候选为 `005eb22dcce570dd1941225cb71cf6dbf6cc1eea`，CI run
  `41200254012` 于 2026-10-31 12:15:05 UTC 启动、12:22:45 UTC 成功结束；
  面板、员工门户、API contracts 和生产镜像四个 job 全部通过。API contracts
  实际执行员工后端整包（`63.088s`）、Usage CSV 导出（`8.375s`）和模型目录
  handlers/server 专项（`0.051s` / `4.692s`）；混合 API 筛选中的员工包仍
  显示 `[no tests to run]`，不能替代独立员工步骤。镜像运行门确认非 root、
  双 PostgreSQL、health、版本、登录/退出和正常重启；runner 生成的镜像
  manifest digest 为
  `sha256:3c8319c6b477f990979f5991874b4e8ca77c9c3c13633e46dd9fa1d8630be9f0`。
  候选 artifact ID 为 `13042491792`，上传包大小 `162917902` 字节，预计
  于 2026-11-07 12:20:14 UTC 过期。已下载到
  `.codex-tmp/candidate-005eb22-41200254012/` 并独立核验：
  `SHA256SUMS`、gzip、Docker/OCI 清单和 8 个 blob 均通过；解压后的
  `image.tar.gz` 为 `162917111` 字节，SHA-256 为
  `5c24de5b9da477bb5563e6d50518d5fe92cf4a342419538518285e4a801635ec`，
  config digest 为
  `sha256:ba1083aaa1b3ede0ecdb1f401553a776662b59401ed1a4d913774cdf3040dd9b`，
  provenance SHA-256 为
  `50f83776f8f7cda0febab2f3d792ea6e1a8353d37c2b81c3805ac24674db4596`。
  来源清单仍绑定完整源码 SHA、`linux/amd64` 和用户 `1000:0`，`RepoTags`
  为空；这些是 **PASS_SCOPED** 的 CI/归档证据，不是正式 registry 发布、
  独立 Docker daemon 启动或生产部署证据。

- 此前已完成 CI 验收的候选为 `3c2b96a723e091be25007adde8e2093ba3dbce8d`，
  run `41199224310` 于 2026-10-31 12:00:56 UTC 启动，
  12:08:04 UTC 成功结束，四个 job 全部通过。新增目录审计步骤实际输出
  handlers `ok`（0.035s）、server `ok`（2.894s），没有
  `[no tests to run]`，关闭该 SHA 的 SQLite 专项 CI 执行缺口，不代表 PostgreSQL
  目录专项、race、真实供应商或全部审计原子性通过。
  镜像 manifest digest 为
  `sha256:c71963f0790dd4a58d5fd17e98ee232052124a410e0251a655030642a28e5b8e`；
  非 root、双 PostgreSQL、health、版本、登录/退出、正常重启和清理均成功。
  候选 artifact `13041918067` 大小 `162918742` 字节，
  于 2026-11-07 12:07:41 UTC 过期；本轮没有独立下载或运行该归档，
  未发布 registry 或部署生产。该 run 的既有混合筛选在 employees 包输出
  `[no tests to run]`，员工门户 job 成功不能替代员工 Go 后端测试；
  后续独立员工回归入口不包含在该 SHA 或该次执行中。
- 此前已推送候选为 `836f43c0614b3d22241dc733c0cff7d99b178193`，
  CI run `41197421345` 于 2026-10-31 11:34:34 UTC 启动，
  11:41:55 UTC 成功结束。面板、员工门户、既有 API contracts 和
  镜像构建/运行四个 job 全部通过；镜像 manifest digest 为
  `sha256:9264da7e8ed5097e7e555dc98fcc2459c7fcbb41431794bfd76056f9183fdd0d`。
  非 root、双 PostgreSQL、health、版本、登录/退出、正常重启及清理步骤成功；
  候选 artifact `13041451371` 已上传，大小 `162919348` 字节，
  于 2026-11-07 11:41:30 UTC 过期。本次没有独立下载或运行该归档，
  也没有发布 registry 或部署生产。该 SHA 的既有 API 筛选
  **不包含** `TestModelCatalog`；不能将整个 CI 成功当作新增目录审计专项通过。
  下述本地 CI 入口修复不包含在该候选或该次 run 中。
- 此前候选为 `b5b90cf3192dc6fe56d15e80071dc7fd7c559295`，CI run
  `41193109692` 于 2026-10-31 10:31:42 UTC 启动，10:38:49 UTC 已成功结束。面板、
  员工门户、API contracts 和生产镜像构建/运行四个 job 全部通过；镜像
  manifest digest 为
  `sha256:35394adb5d6091dfa45f3ebaa820f9e3de5728898205d1b0bc3c01be7cf74cdc`。
  新增候选 artifact
  `elygate-candidate-b5b90cf3192dc6fe56d15e80071dc7fd7c559295-41193109692-1`
  已上传，artifact ID 为 `13040091760`，大小 `162914469` 字节，预计
  于 2026-11-07 10:38:13 UTC 过期。下载后的 `SHA256SUMS`、gzip、Docker
  `manifest.json`、OCI `index.json` 和 `provenance.json` 已独立核对通过；
  来源清单确认完整源码 SHA、`linux/amd64` 和 image ID，无浮动 tag。
  该归档可重新获取，但仍是 7 天 CI artifact，不是正式 registry 发布或
  生产部署制品。
- 此前已推送候选为 `eef56dbb4fed91a1f8bf6a22ca243557b3b43ce6`，CI run
  `41191339255` 于 2026-10-31 10:12:25 UTC 成功结束。独立面板、
  员工门户、API contracts（含单独的 `TestUsageCSVExport` 步骤）和
  生产镜像构建/运行四个 job 全部通过。构建日志中的 manifest digest 为
  `sha256:94790a6a3a83e51b6a935fe2b51bd2f1f59ca804b48365a7de98e2b93aee1713`。
  镜像运行门核对非 root、双 PostgreSQL、health、版本、登录/退出和正常重启，
  最终步骤及清理成功；该历史 run 未导出镜像归档、发布 registry 或部署生产。
  本地新增的归档保留配置不包含在该 SHA 或该次 CI 证据中。
- 此前已推送候选为 `84fb36401327946f1b284714f051d2bc1dd54d42`，CI run
  `41185192165` 于 2026-10-31 08:34:56 UTC 启动，08:42:02 UTC 成功结束。
  独立面板、员工门户、API contracts、生产镜像构建及运行 smoke 四个 job
  均成功；镜像 digest 为
  `sha256:9cf22dc79b5d1720ae039dfb61170f9d9e66de13d8304193453cc5b0595cbb0e`。
  镜像仅在隔离 runner 加载，非 root、双 PostgreSQL、health、版本、
  登录/退出和正常重启检查通过；工作流为 `push: false`，没有发布或部署。
- 该历史 CI 的 API contract 筛选没有包含 `TestUsageCSVExport`，不能据此声称
  新 CSV 行为已通过 CI。后续 `b32733c22` 增加独立导出回归步骤，
  本地构建契约 18 项测试及 PostgreSQL 导出专项通过；上列
  `eef56dbb4` 的 run 已实际成功执行该步骤，不以历史或本地结果替代。
  具体范围、基准代价和剩余边界见 [CSV 导出记录](usage-export.md#verification-follow-up)。
  同 SHA 的 CodSpeed/Snyk 查询时仍排队，不记为通过。
- 上一候选为 `757409947517026f81779f477a0887381bdfc58b`，CI run
  `41179795162` 于 2026-10-31 07:14:06 UTC 启动并于 07:20:34 UTC 成功结束。
  面板测试、员工门户、API contracts 和生产镜像门均通过；镜像实际 digest 为
  `sha256:addecf57df4bb27fe0ea5c05386ba8e1925d6d0796acee057da2f3ee5e1ea52f`。
  CI smoke 已验证非 root、双 PostgreSQL、health、版本、登录/退出和正常重启；
  该镜像尚未发布到生产或执行生产切换。
- `757409947` 的本地 macOS arm64 标准网关使用 Go 1.27.3、`sqlite_static`、
  external linking 构建，二进制 SHA-256 为
  `8d040be8e1f1c1d6735972cbc557394c4b0912221537155f7e66eb168af0db69`。
  独立面板、嵌入目录和实际服务页面仍一致（SHA-256
  `2f3a9845087b96299732c81a6998652053f3382e99798e08cad748dac29f05fa`）。
- 新增的真实 Relay 浏览器验收在同一候选上通过 SQLite 和私有 PostgreSQL：
  管理员登录、面板内创建/编辑/用量预览、真实本地上游转发、SSE、费用日志、
  日志详情、1440/375/812 亮暗主题、reduced motion、无页面错误/横向溢出，
  以及网关和 PostgreSQL 正常重启后的配置/日志保留均通过。报告为
  `output/playwright/relay-live-{sqlite,postgres}{,-restart}-report.json`，
  仅属本地 `PASS_SCOPED`，不证明真实供应商、外部凭据、掉电恢复或生产验收。
- 此前完成 CI 镜像运行验收的候选为 `cb2af42309e45dd0f61beb8d6cc4608c1d9dd4d0`，
  run `41165399877` 于 2026-10-31 11:47:54（北京时间）整体成功。
  镜像已在隔离 runner 中实际加载、启动和正常重启，详见下方运行时记录；
  未发布镜像或部署生产，不将后续本地修改或文档提交视为同一镜像 SHA。
- 同 SHA 的本地 Go 二进制已通过 SQLite 与 PostgreSQL 18.4
  compact/signed 四项运行回归，PostgreSQL 包含停机备份恢复。
  此为 **PASS_SCOPED**；构建输入限制和证据路径见下方本地复验记录，
  不代替正式镜像、其他产品功能或生产验收。
- 草稿 API 初始源码基线：`dev` / `826067def`，包含 Bifrost `c34bd4360`。
  面板草稿接入基线为 `b508f90e7`；不可变版本 API 为 `d5669bde5`，
  面板版本历史为 `d4a4be649`，另有本地初始化竞态修复与验收文档。
  最终发布前仍需重新固定候选 SHA、构建产物和部署镜像。
- 以下历史 Relay 运行/恢复证据来自 `9635d01a3` 及其验收脚本后续增量；
  旧构建不包含新增草稿 API，不能复用于该 API 的运行证明。
  最终发布前需重新固定 SHA 并对其复验，不将本地二进制视为已发布制品。
- 草稿面板阶段全量回归：367 单测、2198 断言及 1 代理集成测试
  （12 断言）通过；此前代理测试超时，单独复跑和全量复跑均通过，
  未修改测试或放宽超时。
  Svelte 检查零错误、零警告，Vite 生产构建通过。
- `core/relay` 与 `core/schemas` 使用外部链接的定向 Go 回归通过。
- 既有 Relay 验收按 Makefile 的 macOS PIE、外部链接和 `sqlite_static` 参数构建的
  标准网关已完成；`go version -m` 记录历史基线 `e6b14def5`，
  `vcs.modified=true`（构建时 tracked 文件无改动，存在本地产物）。
  本地二进制 SHA-256：
  `6a02fce618bcc59e7e251a662ce8020cf660fcd7296a2dbcad511a41c83f5fe0`。
- 增强后的 Relay 真实本地运行验收 `1 pass / 0 fail`：登录、预览、CRUD、
  脱敏凭据往返、Key 创建/轮换/到期/撤销、grant、本地转发、SSE、
  费用、持久化日志、统计、CSV 导出和绑定撤销均通过；
  拒绝请求上游命中数为零，子进程优雅退出与临时目录清理通过。
- 首轮脚本把保留查询串的 `/v1/echo?q=kept` 误判为 `/v1/echo`，已改为
  查询串完整匹配。扩展生命周期夹具初次重复使用同一 Key 名称而被上游拒绝，
  已使用各自 Application ID 命名并重跑通过。未改变网关业务或削弱断言。
- 先前中止的构建/测试和旧 stdin 包装程序启动失败不计为通过；
  本次成功来自新构建的标准 CLI，而非旧包装程序。
- 本机 Docker daemon 不可用；Dockerfile、Compose 或镜像 manifest
  的检查不能替代镜像实际构建与启动。
- 本地 Relay 双 PostgreSQL 真实生命周期、数据库/网关正常重启和停机备份恢复
  已通过，详见下节。这不等于整机、其他功能、升级回滚或生产恢复验收。
- CI、镜像 digest、部署状态和生产数据均需针对最终候选重新核实。
- 路由发布记录页此前因旧二进制缺少入口而验收失败；现已从 `86235f58d`
  完成标准 CLI 重建，核对独立面板、嵌入目录与实际服务页面哈希一致，
  并通过 SQLite、私有 PostgreSQL 的真实登录/只读页/正常重启浏览器复验。
  覆盖 unmanaged 空历史、键盘刷新、1440/375/812 亮暗主题和活动路由不变，
  不等同发布写入、崩溃恢复、最终镜像或生产验收。哈希与清理证据见
  [嵌入产物复验](routing-publication.md#embedded-artifact-verification-follow-up)。
- 员工凭据拒绝已补固定匿名审计和有界来源 IP 限流，详见
  [专项记录](employee-login-failure-audit.md)。失败计数与审计仍为独立事务，
  未关闭 crash window；进程本地限流不替代多实例或反向代理环境验收。
  本次提交推送不构成镜像、部署或生产切换验收。
- `3acde7884` 的员工 PostgreSQL 拒绝/排除矩阵 race 后续复验通过，
  包含审计失败保留 401 和已提交锁定计数；员工 SQLite 整包 race 的 47 项
  顶层测试与 116 项子测试、当前源码 server 整包非 race 回归也通过。
  旧超时不计通过，不替代完整注册路由、真实网络或全产品验收。
- 后续新增标准 CLI 的员工 SQLite 网络验收，两种 compact/signed 模式均通过：
  真实注册路由下的管理员登录、员工创建与登录/退出、匿名拒绝审计、来源限流、
  审计故障保留 401、账号锁定、正常重启持久化、签名链及清理均已验证。
  各次启动均确认数据库 health ping 开启且通过；本地二进制不是最终镜像，
  反向代理及生产环境仍未验收。
- 同一标准 CLI 和扩展后的员工脚本也通过 PostgreSQL 18.4 两种审计模式
  的真实网络流程与两轮数据库/网关正常重启。各次启动均核对双库真实连接、
  无 SQLite 回退、数据库健康；审计故障未撤销已提交计数/锁定，签名链有效。
  两项测试通过且私有库、进程和目录清理完成；扩展后 SQLite 两项也复验通过。
  不外推为掉电/崩溃、密码/TLS、备份恢复、最终镜像或生产验收。
- 发现并修正面板/镜像 CI 工作流的触发范围：`panel-tests.yml` 的 push
  现在覆盖 `main` 和 `dev`，并由面板契约测试锁定；此前 `dev` 直接提交
  不会触发这条测试、构建镜像和 API contract 门。修正已随 `7e5a0fa10`
  提交推送，实际 CI 结果与后续修复见下节；独立的 CodSpeed/Snyk
  仍不能计为通过。

## 功能验收门

| 要求 | 必须提供的证据 | 当前未闭合边界 |
| --- | --- | --- |
| Application Key 生命周期与授权 | 真实 HTTP 创建、调用、过期、轮换、撤销；普通 HTTP、WebSocket、WebRTC、MCP、异步下一动作拒绝 | 不把局部路径测试外推为全路径保证；活动 turn 和媒体流边界仍需明确 |
| 使用量与计费归属 | 项目/应用/用户/供应商/模型可检索，明细、汇总、导出和预算一致 | 合成日志不证明真实供应商计费；多用户、外部通知仍需完整验收 |
| 敏感管理员操作审计 | 按覆盖矩阵逐路由验证成功、失败、取消、重放和持久化 | 完整覆盖及跨存储事务原子性尚未证明 |
| 统一策略与模型治理 | 草稿、发布版本、Shadow、回滚、决策解释；区域与数据等级约束 | 草稿/不可变版本已有双存储网关与浏览器证据，内部接收/安装/审计回滚已有双存储定向证据；仍缺经批准的 ownership 约束、HTTP/面板发布回滚、外部崩溃恢复、在线 Shadow 与模型治理约束，不以内部原语或离线仿真替代 |
| MCP 工具治理 | 风险分级、审批、短期授权、Kill Switch、结果审计 | 按产品规划继续实现；不得将占位页面视作已交付 |
| Relay 独立面板 | 序列化到真实网关、转发、SSE、日志、费用、授权与撤权一致 | 本地 SQLite 和双 PostgreSQL API/正常重启/停机恢复验收已有证据；当前候选的真实浏览器创建/编辑/预览、转发、SSE、费用日志和正常重启也已通过，外部凭据、真实供应商、完整浏览器授权生命周期与生产验收另计 |
| 上游与独立面板集成 | 对最终 SHA 的 Go、面板测试、类型检查及发布构建 | 保留 `panel/`、安全插件与控制面集成，静态嵌入资产需与发布构建一致 |

原始 Must、Should、Could 和明确延期事项仍以产品规划为准；
本文不擅自将未完成 Must 降为可选。

## 路由草稿验证后续项

- parent 为 `826067def`，source 为功能验收门 4，reason 为草稿增量提交时
  Go 测试中断且缺少注册路由回归。具体 API 与边界见
  [路由策略草稿](routing-drafts.md)。
- 2026-10-30 的只读复核发现嵌套 fallback 自定义解码会忽略未知字段，
  原始草稿 JSON 可能携带非法字段落库；后续修复在草稿入口严格校验
  对象字段，保持上游字符串/对象解析不变，不修改共享上游解码器。
- 新增测试覆盖全部草稿注册路由的鉴权、Origin、媒体类型、分页、UUID、
  revision、审计失败原子回滚、安全错误和数据库关闭重开；server 回归核对
  真实编译器拒绝非法 POST/PUT 后草稿、审计及活动规则不变。
- 独立只读复核为 `PASS_SCOPED`，仅代表源码复核。2026-10-30 使用
  Go 1.27.3、`-mod=readonly -vet=off -p 1 -count=1` 的定向运行通过：
  handlers `^TestValidateRoutingDraft`、SQLite controlplane 及 server
  `^TestRouting(Draft|Simulation)`；该修复尚未部署。
- PostgreSQL 首轮发现时间戳 `Location` 的整结构比较误报，已将测试改为
  UTC 归一化后严格比较全部字段。随后使用当前重建的 canonical gateway，
  SQLite 与 PostgreSQL 18 的完整 runtime acceptance 均通过，并确认临时
  存储与进程清理完成。
  此前中断的命令不计通过；后续 `TestRoutingDraft*` 私有 PostgreSQL
  定向测试和 controlplane、handlers、server 三包 `go vet` 已正常退出通过。
- `b508f90e7` 后又尝试默认启用 vet 的控制面 `^TestRoutingDraft`
  定向命令；进程采样和子进程检查确认仍在运行 vet，尚无测试结果时
  显式中断，退出码 130。该次不计通过，也不据此认定业务测试失败；
  后续完成的定向测试与独立 vet 结果才计为通过，不将此次中断当作失败或成功。
- 管理员草稿校验 benchmark：Apple M4、`GOMAXPROCS=2`，
  `43848 ns/op`、`54065 B/op`、`756 allocs/op`。这不是推理路径基准；
  校验只发生在管理员保存草稿时，不给推理请求增加 hook 或缓存。
- 草稿 API 后续项为本地 Native 单 writer、中风险、一名只读复核者。
  不引入推理 hook 或请求缓存；SQL/编译仅用于管理员草稿操作。
  面板接入已在 `b508f90e7` 提交推送：新增分页 CRUD、revision 冲突保留、
  未确认写入锁和认证代次隔离的 SPA 编辑恢复，独立复核 `PASS_SCOPED`。
  草稿 API 已在当前重建 gateway 上完成 SQLite 与 PostgreSQL 18 隔离运行验收；
  浏览器也已通过两种存储的真实网关联调。证据仍是本地验收，不等于部署、
  生产 TLS/SSE/WebSocket、真实供应商或发布回滚验收。
  发布版本、Shadow、回滚、模型治理约束及原生产上线目标保持未完成。
- 本次增量只增加运行验收脚本、修复已加载草稿的选择器名称/revision 显示，
  并补回归断言和文档；Native 单 writer、低风险、external=0。
  面板和 canonical CLI 已重新构建；最终本地二进制 SHA-256 为
  `dbf4f308d80505ee1b9921854d6872f629baf8df2895c84fef2dde11fd3ce557`，
  不视作已发布镜像或生产验收。

## 路由版本历史验收后续项

- follow-up `routing-version-history-live`：parent 为 `d4a4be649`，source 为功能
  验收门 4，reason 为版本面板重启后的浏览器验收未通过。
  本项 Native 单 writer、低风险、external=0，只修复面板初始化顺序及补充证据，
  不修改 Go、鉴权、上游 API 或推理请求路径，不自动提交、推送或部署。
- 真实重跑确认并非单纯脚本等待不足：版本子组件可能先持有共享 busy，
  导致初始草稿列表请求被跳过且不会重试。现改为草稿列表初始化结束后再
  自动读取版本；脚本等待选择器真正启用并包含目标选项，不延长超时。
- 同一重建面板已分别通过 SQLite 和 PostgreSQL 18 浏览器完整流程：
  固定修订响应丢失重试、确认覆盖后保存为新草稿、网关/数据库重启、
  会话保留、源草稿删除后历史可载入，活动规则完整对账不变。
  1440/375/812 亮暗主题无页面横向溢出，页面异常均为 0，临时存储和进程正常清理。
- 本地修复后的面板全量回归为 371 单测、2229 断言及 1 代理集成测试
  （12 断言）；Svelte 零错误/警告，生产构建通过。SQLite 与 PostgreSQL
  API/runtime 契约均已复跑通过，覆盖并发 capture、幂等 replay、审计、重启与源删除；
  两种存储的浏览器运行也是本次新增证据。
- 独立 preview 联调通过后，从当前 `d4a4be649` 加本地修复重建 canonical CLI，
  `vcs.modified=true`；两种存储的完整浏览器流程又直接通过网关嵌入 UI 复跑，
  未使用 Vite/proxy，入口 HTML 与当前面板构建哈希一致。
  这仍是本地二进制，不是已发布镜像。哈希、报告路径、版本 API、内存和存储边界见
  [路由策略草稿与版本](routing-drafts.md#immutable-version-snapshots)。
  已完成的不可变快照不等于发布版本；发布、Shadow、回滚及原生产交付门保持未闭合。

## 本地 Relay 运行验收

执行入口和环境边界见 [panel/README.md](../../panel/README.md)。
`bun run --cwd panel test:relay-runtime` 必须指定本次源码构建的
`ELYGATE_TEST_BINARY`，缺少二进制直接失败，不跳过。

本次已用真实 Bootstrap、生产路由、生产插件和隔离 SQLite 完成通过运行，
后续候选仍须重跑。该测试通过面板的实际序列化与导出函数验收，
而不是 mock 网关响应。
本地上游复用现有 Relay fixture；不继承宿主供应商凭据，
不连接现有数据库，不运行付费调用，不发布或部署。

## 本地 PostgreSQL Relay 恢复验收

后续项 `relay-postgres-recovery` 承接已推送 `9635d01a3` 的 Relay 运行验收，
来源为本清单交付门 3、7 的 PostgreSQL/恢复证据缺口。范围仅为本地测试与文档，
Native、root 单 writer、低风险、external=0；不改生产 Go、鉴权或推理请求路径。
本增量不涉及部署，原产品目标仍为 active / PARTIAL。

- 复核标准 CLI 的 SHA-256 与上列相同，Go 源码/依赖自构建基线
  `e6b14def5` 到 `9635d01a3` 无变化。没有将旧包装程序视作标准 CLI，
  也没有将此次本地复用制品视作最终候选发布构建。
- PostgreSQL 18.4 私有集群只监听权限 0700 的 Unix socket，拒绝 host 认证；
  `fsync`、`synchronous_commit`、`full_page_writes` 为 on。
  config/log 各用一个新库，实际连接与无 SQLite fallback 均经过断言。
- 完整 Relay API 生命周期、SSE、统计、费用、CSV、Key 轮换/过期/撤销通过。
  正常停止并重启 PostgreSQL 与网关后，不重新登录仍能读取原会话、配置、
  Key 元数据、审计和日志；已过期绑定在启动时补记撤销是明确的预期变化，
  其余字段仍严格对账，不通过删去整行比较来忽略数据丢失。
- 网关停机、两库连接池关闭后，用真实 `pg_dump`/`pg_restore` 将两个完整库
  恢复到不同的新库。启动前逐一对账所有 public 表的行数/内容指纹及序列状态。
  应用目录从备份复制，配置仅切换恢复目标；本地 uploads 探针字节一致，
  不外推为 Skills/上传 API 全生命周期验收。
- 恢复后的标准网关保留管理员会话与审计、读取/导出日志，并以原可用 Key
  成功转发；旧轮换值、过期及撤销 Key 均 401，拒绝请求的上游命中数为零。
  新项目/应用/Key 创建、grant、真实转发和后续绑定撤销通过。
  恢复实例读写之后，两个原库的全部行与序列指纹仍保持不变。
- 最终源码专项 `1 pass / 0 fail`（86.36 秒），前一完整运行亦通过。
  成功要求四个私有数据库删除、PostgreSQL/网关/上游子进程正常退出，
  以及含 dump、应用备份与探针的整个临时目录删除。
  结果日志为 `.codex-tmp/relay-postgres-recovery-20261030-verified.log`。
- 初次静态快照断言误将启动过期清理视作数据丢失，已改为明确验证该变更。
  一次初始化因外置卷 I/O 争用超时，没有进入业务验收，不计为通过；
  失败初始化不再错误地要求不存在的服务执行 DROP DATABASE。

这关闭的是本地 Relay 双库正常重启与停机逻辑恢复缺口；没有验证加密密钥恢复、
密码/TLS、真实供应商费用、其他产品工作流、崩溃/掉电、版本升级回滚、完整整机
恢复或生产部署。生产交付门 7、8 仍未整体完成，不能据此批准切换。

### 加密运行材料恢复后续项（2026-10-31）

后续项 `relay-encrypted-materials-recovery`：parent 为 `c3d90e379`，
source 为交付门 7 的加密/签名材料缺口，reason 为此前 Relay 恢复仅覆盖未加密
凭据，且启动所需秘密一直保留在测试进程内。采用 Native、低风险、root 单 writer、
external=0；仅修改既有本地运行测试、本清单和只读发布预检脚本，
不修改生产请求路径或外部状态。

验收范围固定为 compact/signed 两种模式的隔离网关与私有双 PostgreSQL：
停写后备份全部表、序列及应用目录，恢复到独立空库/目录，从权限受限的恢复文件
重新读取启动凭据与加密/签名材料，核对密文、原有会话和 Key 生命周期、签名公钥
与完整链，并证明恢复后的登录/退出、转发、日志和新写入。SQLite 同一生命周期
回归另行运行；不把 SQLite 作为 PostgreSQL 失败时的回退。

当时状态：**历史二进制运行矩阵通过，当前候选验证仍为 PARTIAL**；
后续当前候选证据见下方 `cb2af4230` 本地构建与恢复复验记录。
扩展后的脚本已通过 SQLite compact/signed（2 pass）及 PostgreSQL 18 双库
compact/signed（2 pass），覆盖正常重启、停机备份恢复、恢复后登录/退出、
转发与新写入，以及 signed 模式的密文和签名链延续；临时进程与目录已清理。
这些运行使用 `relay-gateway-v15`，其构建版本为 `d4a4be649`，
不能当作当前源码基线 `c3d90e379` 的最终候选证明。
当前源码构建先因 VCS 扫描主动中止，再以 `-buildvcs=false` 重试；
重试长时间停留在 Go 链接阶段后也已停止，未产出可接受的新候选。
中止不算编译失败或成功，仍需重新构建当前候选并绑定运行证据。
Svelte 检查零错误/警告、Relay 四份合约测试 56 pass，均不能替代该候选运行证明。
此项不涉及付费供应商、TLS、外部 KMS、
崩溃/掉电、其他产品工作流、版本升级回滚、最终镜像或生产切换。
原目标保持 **active / PARTIAL**。

只读预检入口为 `bash scripts/production/single-node-preflight.sh [compose目录]`，
默认检查 `examples/single-node-postgres`；可用 `ENV_FILE`、`BACKUP_DIR` 指定路径。
它核对必需文件、私有权限、Compose 解析、镜像 digest、必需环境值，以及网关和
PostgreSQL 的命令 healthcheck、重启策略、网关等待数据库健康，以及 PostgreSQL
不发布宿主端口/不使用 host network；不启动服务、不拉取镜像、
不输出秘密值。静态预检不能证明 healthcheck 命令确实检测了目标服务，也不能替代
真实连接、TLS、恢复或部署验收。后续静态服务契约的范围与验证见下节。

Relay 运行验收现在还必须显式传入 `ELYGATE_TEST_COMMIT` 的 40 位候选 SHA，
构建命令用 `-X main.Version=v<sha>` 注入版本；首次登录、PostgreSQL 正常重启
和备份恢复后都会核对 `/api/version`。缺少 SHA 或使用旧二进制会在业务验收前
拒绝，版本字符串仍不是供应链签名或镜像来源证明。当前候选的旧 `v15` 二进制
已被该门禁拒绝；当时源码重建在本机外置卷上停滞后停止，未产出可接受的新二进制。

该增量为后续项 `relay-current-candidate-recovery`，parent 为 `fd2f18aff`，
source 为交付门 7 的候选绑定缺口，reason 为历史二进制与当前 Go 代码已有差异。
Native、root 单 writer、低风险、external=0；范围为既有 Relay 运行测试、
执行说明与本记录，不修改 Go 或生产状态。缺失 SHA、非法 SHA 和历史网关
三个真实拒绝检查通过；Relay 合约 56 项和预检 46 项复跑通过。
当前 Go 生产源码与模块输入对照 HEAD 无差异；重建使用 Go 1.27.3、
PIE/外部链接/`sqlite_static` 和 `-buildvcs=false`，显式注入完整候选版本。
进程采样显示仍在读取外置卷的源码/构建缓存，超过 12 分钟后主动停止，
退出 143，不能记为编译失败、编译通过或恢复验收通过。
本轮本地 Svelte 复查也在持续 I/O 等待后停止，退出 143，不计为通过；
下节 `fd2f18aff` 的远端 Svelte 成功是另一份已完成证据，二者不能混用。
截至该次中止，完整 compact/signed SQLite 与双 PostgreSQL 当前候选矩阵为
**PARTIAL**，不覆盖下方后续重建与复验结果。

### 单机预检存储一致性后续项（2026-10-31）

后续项 `single-node-preflight-storage-alignment`：parent 为 `fd2f18aff`，
source 为交付门 2/3，reason 为原预检只检查配置文件存在，`{}` 和数据库服务
与网关服务的凭据不一致也可能通过。范围为两个预检脚本与本记录，
Native、root 单 writer、低风险、external=0；不改生产请求路径或上游合约。

已实际调用 Pi Agent，`gomodel/deepseek-v4-flash` 含自动重试及
`deepseek/deepseek-v4-flash` 均在工具执行前超时，未读取、编辑或产生文件；
本轮另以 `deepseek/deepseek-v4-pro` 复试同一隔离任务，也在工具执行前超时。
进程终止后才由 root 接管同一 writer scope。Pi 实施要求尚未完成，
不能将 root 实现归功于 Pi，也没有修改 provider 配置或泄露凭据。

预检现在要求配置是单个 JSON 对象，两类存储启用 PostgreSQL，
使用模板的 PostgreSQL 环境引用且不显式关闭数据库 health ping；
数据库服务的用户名、密码与库名必须是非空字符串并与网关值一致。
默认同库模板与 health ping 显式启用均有正向用例；空对象、多 JSON 文档、
非法 JSON、错误后端、禁用存储、三个损坏引用及缺失/类型错误/不一致的
数据库环境值均有拒绝用例。错误不输出配置正文或任一侧凭据。
主机和端口仍由部署审阅决定，不声称静态检查证明实际连接。

Bash 语法、ShellCheck、46 个预检用例和 `git diff --check` 通过，
测试目录已清理。此为本地 `PASS_SCOPED`，只验证默认单机同库模板的静态前提；
自定义双库、真实连接、TLS、升级回滚和完整产品功能仍按原交付门验收。
脚本只在上线前执行，无请求路径 CPU/分配或常驻缓存开销。
本后续项已随 `99ba2372c` 提交并推送到 `dev`，未部署，
原总目标继续 **active / PARTIAL**。

### 单机服务契约预检后续项（2026-10-31）

后续项 `single-node-preflight-service-contracts`：parent 为 `005eb22dc`，
source 为生产交付门 2/3，reason 为原预检会放过缺失健康检查、错误重启策略、
不等待数据库健康以及数据库宿主网络暴露的配置。范围冻结为两个既有预检脚本、
单机部署手册和本文；Native、低风险、root 单 writer、external=0。
原功能及生产目标不变；不修改上游业务、数据库、推理路径或生产状态。
本轮已调用 Pi 实施，但其在工具执行前以 `Connection error` / 退出 1 结束，
没有文件产出；确认进程终止后由 root 接管，不将 root 修改记作 Pi 实施成功。
所需 profile-selector skill 和 agmesh CLI 在当前环境仍不可用；
沿用既有单机 Compose/PostgreSQL 配置，不引入新的技术栈或部署方案。

新增负向回归先在旧脚本中复现：
`elygate invalid healthcheck null unexpectedly passed`。
修复要求两个服务有启用的非空 `CMD`/`CMD-SHELL` healthcheck，
重启策略为 `always` 或 `unless-stopped`；网关依赖 `service_healthy`，
本地 PostgreSQL 不发布宿主端口、不使用 host networking。
本轮验证仅使用合成凭据，沿用既有不输出环境值的脱敏错误。部署手册将预检接入启动命令，
只有预检成功才执行 `compose up`；不改变网关对外监听或端口选择。

69 个预检用例通过，覆盖缺失/禁用/空健康检查、启动条件、端口/host network、
不合格重启策略及 `always` 的正向用例。Bash 语法、ShellCheck、
31 项面板构建契约（212 assertions）和 `git diff --check` 通过。
真实 Docker Compose CLI 使用合成环境渲染当前模板，
核对两服务 healthcheck/重启策略、数据库健康依赖和未暴露数据库网络通过；
该命令不连接 Docker daemon，也没有启动服务。
`clean-code-guard: clean`。脚本仅在运维预检时运行，无推理请求开销或常驻缓存。
静态契约不证明探针业务语义、真实健康、主机启动、备份恢复或生产验收；
本后续项的提交、推送状态以 Git 记录为准；未部署，总目标继续 **active / PARTIAL**。

## 生产交付门

### Relay 删除审计的候选验证补齐（2026-10-31）

后续项 `relay-log-audit-ci`：parent 为 `37479df3f`，source 为敏感管理员
审计与最终 SHA 回归门，reason 为已发布 CI 的测试筛选未覆盖 Relay 删除
审计。范围冻结为 workflow、既有 workflow 契约测试和本验收记录；Native、
低风险、root 单 writer（Pi 已终止后接管），不改 Go、schema、依赖、
推理路径或生产状态，不产生请求开销或新增常驻缓存。

`37479df3f` 的候选归档已从 CI artifact 独立下载并校验：来源
commit、`SHA256SUMS`、gzip、Docker archive、OCI index、manifest、config
和 6 个 layer blob 一致；镜像为 `linux/amd64`、运行用户 `1000:0`，
image ID 为 `sha256:3ce8fbfdc273f416ea1247acf1ad78beb4b0d0621d0af0afbc6fadc08710f2ad`。
CI 的 panel、employee-portal、api-contracts 和 Docker runtime 四个 job
均成功，runtime 通过非 root、双 PostgreSQL、health、版本、登录/退出及
正常重启检查；artifact 不是 registry 发布或生产部署证明。
归档位于 `.codex-tmp/candidate-37479df-41209424680/`；8 个 blob 的
SHA-256 全部匹配，未解包到文件系统或在本地 Docker daemon 中加载运行。
`image.tar.gz` 为 `162918992` 字节，SHA-256 为
`d0c6d31fe5bef965346b9c62264b9307b032345d730c48a7544465aab154188c`；
provenance SHA-256 为
`85aabddcd71b1fe597fd4af508817e81f59c27459f9102499a2f42f61ef98a04`。

复核发现该候选的 `api-contracts` job 尚未专门执行新增的
`TestRelayLogsDeletionAudit` / `TestRelayLogsDeletionAuditThroughManagementRoute`。
本地已补充独立 workflow step 和 panel contract 断言；当前本地命令
`bash scripts/go-local.sh test -p 1 ./transports/bifrost-http/handlers ./transports/bifrost-http/controlplane -run '^TestRelayLogsDeletionAudit' -count=1 -timeout=180s`
在编译依赖等待超过 10 分钟后被有界终止（退出 143），未进入业务测试、
没有 `ok` 结果，不计通过；`-timeout=180s` 只约束测试执行，不含构建时间。
31 项 workflow contract 测试（214 断言）和 actionlint 通过。
读取 HEAD 原始 YAML 可复现专项缺失；最终 YAML 的步骤顺序与完整命令断言通过。
上述本地构建中断保留为历史证据，不被后续 CI 成功改写。
workflow 补丁随后以 `7bc4b770c` 提交并推送到 `origin/dev`，
run `41212521367` 的 Relay 专项实际输出 handlers `ok`（`0.049s`）、
controlplane `ok`（`3.906s`），独立步骤及四个 job 全部成功。
该执行只证明 SQLite 专项，不是 PostgreSQL、race、全路由审计或生产验收。
Pi `gomodel/code`
两次调用均在执行前返回 `Connection error`，未产出文件；本次由 root
按同一窄范围接管。
无凭据输出的认证检查仅返回 `ready`，不代表模型连接或实施成功。
同一已配置端点的无凭据 HEAD 检查在 5 秒后超时；未改全局配置或切换模型。
独立 handlers `go vet` 等待超过 13 分钟后被有界终止（退出 143），
只出现 sqlite-vec 的 macOS CGO 弃用警告；该次不计通过或业务测试失败。
控面独立 vet 未执行；此前命令中断的记录不因此被改写为通过。生产部署、
完整审计原子性、策略 ownership/发布/Shadow/回滚等原始门继续未闭合。
`clean-code-guard: clean`，最终 diff 检查通过。提交、推送状态以 Git
记录为准；未部署，总目标继续 **active / PARTIAL**。

### 当前 Relay 面板真实链路（2026-10-31）

后续项 `relay-current-panel-live`：parent 为 `757409947`，source 为 Relay
独立面板功能门，reason 为 API 夹具和真实网络 API 测试不能证明实际嵌入
面板写入同一网关。采用 Native、低风险、单 writer，仅新增本地验收脚本和
本记录，不改 Go、面板业务、上游合约、依赖或生产状态。

Pi `gomodel/code` 本次实施调用再次返回 `Connection error`，退出 1，
未产出文件；确认进程结束后 root 接管其 writer scope。Pi auth readiness
不计为实施成功，也没有切换 verifier runtime。

同一当前 SHA 的网关通过管理员真实浏览器登录和独立隔离存储：

- 未认证 Relay 管理读取被拒绝；新建、编辑、完整 PUT 往返和未保存用量
  预览均来自实际 UI 请求，无浏览器 API 拦截。凭据使用随机环境值引用，
  重开编辑器不会回填明文。预览样本费用为 `$0.041`。
- 使用真实 Application Key，首次无 Relay grant 的请求返回 403 且本地
  上游命中为零；授予后搜索、凭据注入检查及 SSE 成功。真实日志详情与
  费用一致，但此处本地上游不代表外部供应商或其计费。
- SQLite 和私有 PostgreSQL 各在网关正常重启前后通过；PostgreSQL 还正常
  重启其自有数据库进程，核对双库连接、持久性设置、无 SQLite 回退。
  停机前后的完整端点响应和既有日志逐项相等，原浏览器会话与 Key 仍可用。
- 每次记录编辑器及日志页各六种 1440/375/812 亮暗布局，reduced motion、
  页面异常数零和无页面横向溢出。检查了桌面与手机截图；模态内部正常滚动，
  宽日志表格保留内部滚动，不把局部视口截图当作全部表单内容验收。

脚本位于 `.codex-tmp/relay-live-{fixture.ts,browser.js,cli.ts}`，
四份报告与配套截图位于 `output/playwright/relay-live-*`。
两次早期脚本定位错误（下拉控件标签、同 hash 导航未卸载旧 dialog）已在
测试脚本中修正；未改变产品代码、放宽断言或把失败轮次记作通过。
退出后均核对私有数据库、网关/上游进程、应用目录与秘密元数据已清理；
浏览器会话也已关闭。当前 SHA 的 Relay helper 与 SQLite compact/signed
网络回归合计 35 项通过；最初遗漏必需二进制环境值的调用不计通过。
面板生产构建及 Svelte 检查零错误/警告，`git diff --check` 通过。

本项为 **PASS_SCOPED**，没有推理路径 CPU/分配或常驻内存增量；
不覆盖所有认证方案、浏览器 Key 授权/撤销全流程、真实外部账号、崩溃恢复、
最终镜像内的完整 Relay 矩阵、TLS、升级回滚或生产切换。
原目标保持 **active / PARTIAL**，没有自动提交、推送或部署本项。

### SVAdmin 迁移镜像输入修复（2026-10-31）

后续项 `svadmin-unpatched-image-inputs`：parent 为 `86235f58d`，source 为
run `41177876822` 与交付门 1，reason 为最后一个包补丁移除后 Git 不保留
`panel/patches` 空目录，但三个 Dockerfile 仍强制 COPY 该路径。
该 SHA 的 Docker job 在复制阶段失败，未生成镜像；不计为镜像运行验收通过。

本地修复仅删除三个镜像入口的失效 COPY，保持 manifest/lockfile 先复制、
`bun install --frozen-lockfile`、随后复制源码的分层顺序不变。
构建契约同步核对无补丁的 manifest、三个入口的安装顺序和失效路径拒绝；
构建契约与路由只读模型合计 23 项测试通过，Svelte 检查零错误/警告，
`git diff --check` 通过，`clean-code-guard: clean`。
Native、root 单 writer、低风险，修改只在镜像构建时生效，
无推理路径 CPU/分配或常驻内存开销。

本机 Docker daemon 不可用，不能把静态契约通过当作镜像构建通过；
提交时修复候选仍待远端 CI；随后 `757409947` 的 run `41179795162`
已实际完成镜像构建和运行证明，见候选版本记录。Pi 实施调用仍因
`Connection error` 未产出文件，不计成功。原总目标保持 **active / PARTIAL**。

### `fd2f18aff` 候选 CI 复验（2026-10-31）

`fd2f18affc64f74e864972ab02d6dd4be45d7d67` 的 run `41160000132`
已整体完成成功：面板单测/Svelte/构建、员工门户和 API contracts 均通过。
生产 Docker job 对同一 SHA 实际构建、加载并启动镜像，
构建 digest 为 `sha256:e36f1e0130ed6eb72e648807895fc99cc0f04901dd82fcc18ef2c24b0e0beda7`。
镜像阶段核对非 root、双 PostgreSQL 实际连接、数据库 health ping、
版本等于候选 SHA、匿名管理拒绝、管理员登录、数据库/网关正常重启后会话保留、
退出及后续拒绝；测试退出与容器/卷/网络清理成功。

该 job 不执行上节 compact/signed Relay 恢复矩阵，不能替代当前候选的加密
备份恢复证明，也未发布可拉取的生产制品。Snyk `41160000090` 和
CodSpeed `41160000108` 当前仍 queued，不计为安全或性能验收通过。
该镜像不包含其后 `99ba2372c` 的预检变更；整体保持 **active / PARTIAL**。

### 生产预检 CI 接入后续项（2026-10-31）

后续项 `single-node-preflight-ci`：parent 为 `99ba2372c`，
source 为交付门 1/2 与持续推进指令，reason 为预检脚本变更尚未进入
工作流路径过滤器和远端必跑检查。范围为 `panel-tests.yml`、既有构建契约测试
与本记录，Native、root 单 writer、低风险；不修改生产请求路径、发布权限或部署状态。

两次 Pi 实施请求分别使用 `deepseek/deepseek-v4.1-flash` 和精简上下文的
`deepseek/deepseek-flash`，均以 `Request timed out` 退出，工具执行前未产生改动。
另一个无工具的 `gomodel/deepseek-v4.1-flash` 最小连通请求也超时；
凭据 readiness 的 `ready` 不证明远端调用可用。确认所有请求退出且工作区无
Pi 产物后，root 接管同一 writer scope；Pi 实施要求仍未完成。

`cb2af4230` 已提交推送到 `dev`：push/PR 同时监听 `scripts/production/**`，
面板 job 在安装依赖前从仓库根执行 Bash 语法、ShellCheck 和全部预检用例，
不静默跳过工具缺失或错误。新增 YAML 契约锁定命令、执行顺序、根目录和
失败传播；既有只读权限、Docker 不发布及镜像运行门保持不变。
本地构建契约 15 项、预检 46 项、Bash 语法、ShellCheck 与 diff 检查通过，
`clean-code-guard: clean`。远端 run `41165399877` 已整体成功：
预检 46 项、面板单测 378 项和代理集成 1 项、Svelte 零错误/警告、面板构建、
员工门户与 Go API contracts 均通过。Docker job 对同 SHA 实际构建、加载、
启动并通过非 root、双 PostgreSQL、健康、版本、登录退出、正常重启与清理；
镜像 digest 为 `sha256:c6232e9c883ff8bd258661a5a630bf710871d026255b5961624cb3377ff55c87`。
该镜像未发布或部署，不替代 Relay compact/signed 恢复矩阵。
API job 仍有 setup-go 未找到根 `go.mod` 的缓存警告，测试成功但没有缓存命中证明；
Snyk `41165399889` 和 CodSpeed `41165399902` 本轮查询仍 queued，不计验收通过。
本项只增加 CI 检查，没有推理路径 CPU、分配或常驻缓存开销。

作为前置证据，`99ba2372c` 的 run `41164546335` 已整体成功，包含面板、
员工门户、Go API contracts 及同 SHA Docker 实际构建、加载、启动与正常重启。
镜像 digest 为 `sha256:4ec3530629972f390add224067abd2b39c1b9f980f75a8430a7cd202e99835b0`，
运行门核对非 root、双 PostgreSQL 连接、数据库 health ping、版本、登录退出与清理；
没有发布该镜像或部署生产，也没有执行 compact/signed Relay 恢复矩阵。

本轮再次使用 Go 1.27.3、PIE、外部链接、`sqlite_static`、`-buildvcs=false`
与完整 `99ba2372c` 版本注入重建本地网关；Go 源码和模块输入相对 HEAD 无差异。
采样仍主要为 `read/stat/pread`，持续低 CPU 后主动停止，退出 143，
没有生成新的候选可执行文件，不记为编译失败或通过；采样位于
`.codex-tmp/current-candidate-build.sample.txt`，不纳入提交。
截至该次构建中止，候选加密恢复、策略发布/Shadow/回滚、完整敏感审计、TLS/反向代理、
升级回滚及显式生产切换授权均未被本项替代，原目标保持 **active / PARTIAL**。

### `cb2af4230` 本地构建与恢复复验（2026-10-31）

承接后续项 `relay-current-candidate-recovery`，parent/source/reason 和原验收范围
保持不变。Native、root 单 writer、低风险、external=0；本次只补充执行证据，
不修改业务代码、不发布镜像、不部署生产。

外置卷构建停滞后，在本机临时磁盘创建干净稀疏 clone，精确 detached 到
`cb2af42309e45dd0f61beb8d6cc4608c1d9dd4d0`，成功构建标准网关。
使用 Go 1.27.3、CGO、`-p 1 -mod=readonly -buildvcs=false -trimpath`、
PIE、外部链接和 `sqlite_static`，注入 `main.Version=v<完整候选 SHA>`。
`go.work` 和 `go.work.sum` 从原工作区复制；Go/模块目录及 Relay 运行脚本
相对文档提交 `0ac361e55` 无差异。嵌入 UI 复用原工作区现有约 32 MB 静态资源，
不是该 clone 重新构建的面板，因此本地制品只证明下述 API/恢复行为，
不证明新前端、可复现发布构建或正式镜像。

二进制复制回 Datas 后 SHA-256 一致：
`9db84e075be360320945a7e6db27cfb90ef1d5a2bb09c8fa0f8afe80721a867c`。
本地证据目录为 `.codex-tmp/relay-cb2-proof-20261031.ltXiXt/`，
包含 `relay-gateway`、`build-info.txt`、`source-trees.txt`、
`workspace-inputs.txt` 和运行日志；这些本地制品不纳入 Git。

临时 clone 已通过 SQLite compact/signed（2 pass / 0 fail）和
PostgreSQL 18.4 compact/signed（2 pass / 0 fail）。复制回 Datas 后，
从原工作区再次执行同一运行脚本，SQLite compact/signed 为
**2 pass / 0 fail**，PostgreSQL 18.4 compact/signed 为 **2 pass / 0 fail**，
日志分别为 `sqlite.log` 与 `postgres.log`。PostgreSQL 核对全部表/序列、
源库不变、正常重启与双库停机备份恢复、文件和秘密材料恢复、会话/Key/
转发/日志/新写入，signed 模式另核对密文、原签名公钥及审计链延续。
私有库、测试子进程和临时测试目录清理通过，未残留运行中的网关或夹具进程。
以上四项为当前 Go API/恢复范围的 **PASS_SCOPED**，
不是最终发布验收；SQLite 不替代 PostgreSQL 恢复。
首次登录、PostgreSQL 正常重启和恢复后均要求 `/api/version` 等于完整候选 SHA。
这些证据不代表 PostgreSQL 16、真实供应商、TLS/反向代理、崩溃恢复、
升级回滚或整机恢复；总目标继续 **active / PARTIAL**。

Pi 诊断补充：`gomodel/qwen3.8-flash-next` 无工具最小请求仍超时，
已配置的 deepseek/gomodel 端点无凭据 TCP 检查均连接超时；
Pi 的 `anthropic/claude-sonnet-4-6` 最小请求返回
`401 invalid x-api-key`。没有修改 provider 配置或输出地址与凭据，
没有 Pi 实施产物；该要求仍未满足，需要恢复端点或更新有效凭据。
本次仅记录验证结果，无请求路径 CPU/分配或常驻缓存开销。

### Dev CI 触发后续项（已由 `cb2af4230` 闭合，2026-10-31）

后续项 `panel-ci-dev-trigger`：parent 为员工双存储运行验收 / `ffc591530`，
source 为交付门 1 的 CI 证据缺口，reason 为既有面板工作流只监听
`main` push，未覆盖当前 `dev` 直接提交。Native、root 单 writer、
低风险、external=0。范围仅为 push 分支、既有构建契约回归和验收文档；
不修改 job 内容、路径过滤、权限、runner 配置、密钥或部署规则。

YAML 结构化回归核对了 `main`/`dev`、原路径过滤和 PR/手动入口，
`contents: read` 及 Docker `push: false` 保持不变。该历史后续项的修正
已随 `99ba2372c` 推送并在 `41164546335` 完成远端验证；随后由
`cb2af4230` 接入生产预检并重新跑通完整工作流。
本地 YAML 回归已通过：构建契约包 9 项测试、53 项断言；对照 HEAD
确认旧分支列表仅为 `main`，当前为 `main`/`dev`。变更前本轮完整面板
371 项测试、2229 项断言以及独立代理集成 1 项、12 项断言通过；
添加 CI 契约后已定向复验该包，未把这两组数字相加冒充一次全量运行。
当前面板 Svelte 检查零错误、零警告，server 整包非 race 回归通过
（7.770 秒），`git diff --check` 通过。
仅修改 CI 触发与测试/文档，不增加请求路径工作、分配或保留状态。
本后续项已由后续提交取代；当前远端执行证据见
`41165399877`，仍没有发布镜像、dispatch 生产切换或部署生产。
本次只读查询中，`ffc591530` 的 CodSpeed run `41137143692` 四个 job
等待 `codspeed-macro` label，Snyk run `41137143713` 两个 job 等待
`builder-8-32` label，均为 queued、无已分配 runner；这不证明仓库或组织
没有可用 runner，也不证明扫描/基准已成功。没有更换上游 runner、
取消 job 或写入远端配置。
本机 Docker context 为 `orbstack`，本轮 `docker info` 仍返回 socket
不存在；没有启动 daemon、切换到其他 context 或将 Dockerfile 检查当成
实际构建。最终镜像构建、启动、健康与非 root 验收继续未完成。

### API 契约 CI workspace 修复（2026-10-31）

后续项 `panel-ci-api-workspace`：parent `7e5a0fa10`，source 为
run `41142015547` 的 `api-contracts` 失败，reason 为 runner 未初始化
Git 忽略的 Go workspace。Native、root 单 writer、低风险、external=0；
范围冻结为该 job 的 Go/workspace 初始化、构建契约测试和本清单，
不修改业务代码、测试筛选/断言、权限、runner、发布或部署规则。

候选 `7e5a0fa10` 的远端 run `41142015547` 中，面板测试、员工门户和
Docker BuildKit 构建均通过；`api-contracts` 在测试启动前失败，原因是
干净 runner 没有被跟踪的 `go.work`，而该 job 直接调用 `scripts/go-local.sh`
后得到“cannot find main module”。这不是业务测试失败，也不能计作 API
契约通过。Docker job 的日志显示镜像仅留在 runner 的 BuildKit cache，
没有导出可部署镜像。

后续修复在本地工作树中加入仓库现有的 `setup-go-workspace.sh` 初始化步骤、
显式 Go `1.27.3` 和 job 级 `GOTOOLCHAIN=auto`，避免包装脚本默认固定
`go1.27.0`；原 API 契约命令、正则和超时保持不变。
构建契约 10 项测试、60 个断言及 workspace 初始化脚本自身 4 项测试通过。
Git 源码导出已成功从无 workspace 初始化为 Go 1.27.3；缓存读取运行
被显式中断，随后系统盘链接发生 `no space left on device`，均不计通过。
再将编译目录和缓存置于 `/Volumes/Datas` 的复验也被显式中断（退出码 130），
没有 API 测试结论；未改写原候选源码。仅将初始化与 YAML 回归记为
`PASS_SCOPED`，Go API 执行仍为 `PARTIAL`，不把中断记作业务测试失败或成功。
系统盘仅剩约 300 MiB 时已停止本轮昂贵验证，没有删除共享缓存或其他工作区文件。
CI 配置与测试不增加推理请求工作、分配或保留状态。

修复已随 `0bf3a568f` 提交并推送，远端 `dev` SHA 核对一致。
该 SHA 的 run `41146260989` 已于 2026-10-31（北京时间）完成并整体成功：
`api-contracts` 5m55s、面板测试/检查/构建 45s、员工门户 23s、
Docker BuildKit 构建 4m34s。已检查 API job 确实经过 Go 安装、workspace
初始化和原 API 契约命令，而非跳过、仅初始化或重跑旧 SHA。
该远端通过不抹除上述本地中断/磁盘不足记录。

此后只读查询中，同一 SHA 的 CodSpeed run `41146260996` 与 Snyk run
`41146260979` 仍排队，不计通过。Docker 构建未发布或加载镜像，
上传的 `.dockerbuild` 只是构建记录，不是可部署镜像，也未执行容器启动、
健康或非 root 验收。该 CI 修复为 `PASS_SCOPED`，生产清单仍为 **PARTIAL**。

### Docker 镜像运行时冒烟后续项（2026-10-31）

后续项 `panel-ci-image-runtime-smoke`：parent 为 `336582902`，source 为
交付门 1/2 的镜像运行证据缺口，reason 为此前 Docker job 只保留 BuildKit
缓存，未加载、启动或重启候选容器。Native、root 单 writer、低风险、
external=0；仅修改面板 CI、契约测试、冒烟脚本和本清单，不修改业务请求路径、
权限、发布推送或生产配置。

`panel-tests.yml` 现在以 `load: true` 加载本次构建镜像，传入完整提交 SHA，
并调用独立的 `smoke-elygate-image.sh`。脚本从固定 digest 的单机 PostgreSQL
模板启动隔离配置库和日志库，验证镜像非 root、双库健康、无 SQLite 回退、
匿名管理接口 401、管理员登录/配置/版本、网关和数据库正常停止重启后的会话
读取、退出登录失效以及容器无 OOM/意外重启；退出时清理容器、卷、网络和临时目录。
脚本只生成临时密码和加密 key，不写入仓库或日志。

本地已通过 `actionlint`、`bash -n`、`shellcheck`、`git diff --check` 及
面板构建契约定向测试；本机 OrbStack/Docker daemon 不可用，因此本地未执行
容器运行验收。该后续项在提交前为 `PASS_SCOPED`，推送后必须以新 SHA 的
Docker job 实际日志确认运行时冒烟通过；CodSpeed/Snyk 排队不计通过。

#### 端口映射修复

后续项 `panel-ci-image-runtime-network`：parent 为 `6dd667eba`，source 为
run `41149350716` 的 Docker runtime 失败，reason 为脚本在 `--internal`
网络上请求宿主端口发布，Docker 29.4.2 runner 未生成端口映射。
Native、root 单 writer、低风险、external=0，范围仅为冒烟脚本、
构建契约回归和本清单；不修改业务代码、镜像内容、权限或生产状态。

该 SHA 的面板测试/检查/构建（58s）、员工门户（21s）、API 契约（6m6s）
和 Docker 构建加载均已通过，但冒烟在读取端口时报 Go template 空值错误，
尚未进入健康、登录或重启断言，不能记作运行通过。
改用本次独享的普通用户自定义 bridge；PostgreSQL 不发布端口，网关仍只
绑定 `127.0.0.1` 临时端口。网络允许出口，不再宣称禁止外连；脚本仍使用
空供应商配置、本地目录夹具和临时凭据，不继承供应商凭据。
端口映射改为结构化校验唯一回环映射及有效端口，失败时只打印容器运行状态
和端口信息，不输出容器环境、配置、Cookie 或密码。
模拟 Docker 的本地回归验证空值/非回环映射均明确失败，且清理资源和临时目录；
这不替代真实容器运行。新候选仍需推送后核对 CI，整体保持 **PARTIAL**。

`006b9f102` 的 run `41150613823` 证实端口映射已生成且仅绑定回环，
PostgreSQL 未发布端口；面板、员工门户和 API 契约再次通过。
但网关两分钟内未满足健康就绪，运行时失败；清理前两个容器均 running，
无 OOM 和自动重启。此前的端口修复不代表镜像运行验收通过。
后续仅增加失败时的 Docker health 信息及最多 100 行网关启动日志，
输出前逐一替换本次随机数据库密码、加密 key、setup token 和管理员密码，
并以模拟日志回归确认四类值均被脱敏。不输出环境/配置或 Cookie。
健康断言和等待期限保持不变，需从下一候选的实际日志定位根因。

`cb3f4cbb4` 的 run `41151543975` 进一步确认这不是首次启动失败：
日志已出现首轮正常停止及第二次启动，第二次启动仅用 670ms，两个存储均
初始化成功，Docker health 为 healthy。失败发生于重启后的宿主 HTTP 就绪探测，
脚本仍使用第一次分配的随机宿主端口。后续项
`panel-ci-image-runtime-restart-port` 以该 SHA/run 为 parent/source，
仅将端口解析纳入每次网关等待，保留唯一回环映射校验、原健康条件和超时。
模拟回归让 stop/start 前后端口从 49152 变为 49153，并要求健康、会话读取、
退出及最终匿名拒绝使用新端口；真实镜像完整重启验收仍待新候选 CI。
该参数化子进程测试单独使用 30 秒执行预算，不改变镜像健康等待；
首次本地默认 5 秒运行因 I/O 争用超时且由 Bun 终止子进程，不计通过。
随后同一源码以 30 秒测试预算完整通过：14 项测试、111 个断言，
包括缺失/非回环映射拒绝、四类 secret 脱敏、端口变化后的完整模拟流程和清理。

#### 真实运行验收通过

`b597d945b69e6b06948b1da8fdd8d615c6cf8883` 的 run `41153100098` 已完成且
整体成功：面板测试/检查/构建 55s、员工门户 30s、API 契约 5m58s、
Docker 构建与运行 5m31s。面板为 377 项单测、2303 个断言，另有代理集成
1 项、12 个断言；Svelte 检查零错误/警告，生产构建通过。

Docker job `124394138859` 已实际加载本次构建镜像，构建记录的 digest 为
`sha256:1f552d24639b57ad4512593baa73a6d131c7c18108ced06b69b50da926da38b0`。
运行时步骤于 09:05:13 至 09:05:54（北京时间）成功退出：
非 root UID 1000、固定 digest PostgreSQL 配置/日志双库连接、
无 SQLite 回退、开启数据库 ping 的 `/health`、匿名配置 401、
管理员登录/配置/候选版本、网关与数据库正常退出码 0、
正常重启后重新解析临时端口并保留会话、显式退出后旧会话 401 均通过。
脚本打印断言通过后仍执行 cleanup；步骤最终 success/退出码 0
才作为容器、卷、网络及临时目录清理成功的证据，不以提前打印的 PASS 单独判定。

这关闭的是该 SHA 的隔离 CI 镜像构建、启动和正常重启缺口，不是供应商调用、
完整产品功能、反向代理/TLS/SSE/WebSocket、升级回滚、整机备份恢复或生产切换验收。
镜像 `push: false`，未发布到 registry，也未导出可重新部署的镜像归档；
上述构建 digest 不是已发布镜像的拉取凭证，正式发布仍需固定并验收可获取的制品。
同一 SHA 的 Snyk run `41153100040` 两项 job 仍等待 `builder-8-32`，
CodSpeed run `41153100016` 四项 job 仍等待 `codspeed-macro`，均无已分配 runner，
不计安全扫描或性能通过。整体目标继续 **active / PARTIAL**。

### 单机备份恢复说明修正（2026-10-31）

后续项 `single-node-recovery-guide`：parent 为镜像运行验收候选 `b597d945b`，
source 为生产交付门 7/8，reason 为既有手册依赖未导出的宿主 `.env` 变量、
只描述单个数据库备份，且恢复命令直接删除目标库。纯文档后续项，
Native 单 writer；不执行数据库、Docker、部署或生产写入。

手册将变量展开移到容器内，增加停写窗口、私有备份目录、archive 可读性检查
及运行目录/配置备份，明确默认同库与自定义双库的区别。恢复只允许隔离空目标，
保留原始库与文件，使用事务化、遇错退出的导入；不再提供删除原库或清理原表的示例。
同时明确运行文件、加密/签名材料、权限、恢复后对账与写入缺一不可。
文档命令只作 Bash 语法和边界检查，未执行真实备份恢复；这不关闭交付门 7/8，
也不改变原产品功能范围或整体 **active / PARTIAL**。

### 单机一致性备份入口（2026-10-31）

后续项 `single-node-consistent-backup`：parent 为
`single-node-recovery-guide`，source 为生产交付门 7，reason 为既有手册只有
内联命令，容易在网关仍运行、双库拓扑或备份产物权限不满足时误用。
Pi 实施调用在工具执行前返回 `Connection error`、退出码 1，未产生改动；
随后由 root 按同一冻结范围接手，未执行生产写入。
本项为中风险 Native 单 writer 加一次独立只读 verifier；范围为备份脚本、
专项测试、部署手册与本记录，并为默认备份目录补充模板专属 Git 忽略规则，
避免敏感产物被误暂存，不改变其他未跟踪目录。

新增 `scripts/production/single-node-backup.sh` 及确定性 shell 回归。入口要求
操作者显式确认已停掉 Elygate 且排除了其他数据库写入者；它只接受预检通过、
默认同库 PostgreSQL 配置、网关已正常退出、PostgreSQL 健康运行和不可变镜像，
不会自动停止/启动服务、删除数据库或归档 `.env`。备份在私有临时目录中生成，
包含 custom `pg_dump`、`pg_restore --list`、未在宿主展开的 `runtime.tar`、
配置、Compose 文件、实际容器镜像元数据和 `SHA256SUMS`，成功后才原子改名；
失败不留下成功目录，并拒绝捕获期间的源文件或容器状态变化。

本项仅证明静态边界和 fake-Docker 错误/成功路径，不证明真实 Docker、
数据库恢复、掉电安全、升级回滚或生产验收；原目标保持 **active / PARTIAL**。
30 项备份场景与既有预检回归、shellcheck、Bash 语法及 diff 检查通过，
包含源容器与部署文件变化拒绝、失败清理、权限、元数据脱敏和校验和损坏检测。
独立复核指出旧容器残留 `APP_DIR` 可能使归档目录偏离真实数据目录；
后续已改为核对实际容器的唯一 `APP_DIR=/app/data` 和标准启动命令/entrypoint，
并增加残留、缺失、重复值及两个启动覆盖拒绝场景。
实际容器的运行卷和 PostgreSQL 卷名也必须与 Compose 解析结果一致，
旧卷残留的两个拒绝场景已加入回归。容器状态恢复正常不能替代数据卷一致性。
本机有界 Docker daemon 检查返回不可用，未启动真实容器或操作生产环境。
推理路径与常驻内存不变；备份期间仅运行一次 dump、归档和顺序校验和计算，
磁盘需求取决于数据库逻辑 dump 加运行目录 tar 大小，须由操作者提前留足空间。

### 单机备份 CI 接入（2026-11-01）

后续项 `single-node-backup-ci`：parent 为 `single-node-consistent-backup`
（`486a272b3`），source 为持续上线目标与交付门 7，reason 为新备份专项尚未
进入既有面板 CI。范围冻结为 workflow、构建契约测试和本记录；
Native、低风险、单 writer、external=0，不修改业务行为或生产状态。

2026-11-01 按持续上线目标再次调用 `pi agent` 接入该专项，调用以
`Connection error`、退出码 1 结束且未产生文件；随后由 root 完成同一窄范围
接入。`panel-tests.yml` 现在逐条执行四个脚本的 `bash -n`、四个脚本的
ShellCheck、既有预检回归和 30 项备份回归，面板构建契约同步锁定命令顺序。
语法检查必须逐文件运行，不能把 `bash -n` 的后续脚本参数误当作检查目标。
本地构建契约 31 项（214 个断言）、两组生产脚本回归、ShellCheck、actionlint
和 diff 检查通过；面板全量 411 项（2489 个断言）、代理集成 1 项（12 个断言）
通过，Svelte 检查 0 错误、0 警告。最终逐文件语法命令与构建契约另已复跑通过。
该改动随后以 `4d421b50b` 提交推送，run `41219185774` 四个 job 全部成功，
其中生产预检步骤包含新增备份专项；不能用更早的 `486a272b3` run 替代。
这关闭 CI 执行缺口，不证明真实备份恢复或生产部署。成本仅为 CI 测试时间；
无推理请求或常驻内存开销，原总目标保持 **active / PARTIAL**。

### Webhook 已提交变更审计与 CI 后续项（2026-11-01）

后续项 `webhook-committed-audit`：parent 为 `4d421b50b`，source 为敏感管理员
操作审计门，reason 为数据库写入成功后，reload/remove callback 的 panic
可能丢失成功变更的审计。Native、中风险、root 单 writer，加一次独立只读
verifier；先前 Pi 调用均以 `Connection error`、退出 1 结束且未产生代码，
root 在调用终止后接管，不能记作 Pi 实施成功。

`3e6b1f609` 将 create/delete/rotate 的 producer 放在提交后、callback 前；
update 在提交后注册 defer，正常路径保留 canonical row 的完整脱敏快照，
reload error/panic 或缺缓存时只记录既有请求的可编辑字段，并脱敏 Headers/URL，
不伪造数据库时间戳或失败计数。失败写入与拒绝请求不记成功事件，已提交变更
只记一次；没有新增数据库读取、依赖、接口、推理路径工作或常驻状态。

SQLite 全部 `^TestWebhookHandler` 和 33 个真实管理注册路由场景通过，
覆盖鉴权、非法请求、缺失对象、写入失败、reload/remove 错误与 panic、
缺缓存、producer 去重、实际数据库写入、受保护 feed、身份/关联与脱敏，
并验证审计失败不改写一次性凭据响应、返回失败标记。
独立只读源码复核为 `PASS_SCOPED`，不替代运行结果。
管理端 update 基准（不含 SQL/投递）为 `6319 ns/op、10546 B/op、
69 allocs/op`；同一 benchmark 使用经 SHA-256 核对的 `4d421b50b` 原 handler
overlay 测得 `6069 ns/op、10642 B/op、69 allocs/op`。各为 Apple M4 单次
采样，不能据此声称延迟无退化或提供生产性能保证。
格式及 diff 检查通过。当时 PostgreSQL 与 race 尚未验证；下方后续项补充
PostgreSQL 证据，真实网络、跨事务原子性、崩溃恢复与生产验收仍未完成。

独立后续项 `webhook-audit-ci`：parent 为 `3e6b1f609`，source 为本次持续上线
目标与 CI 筛选复核，reason 为现有 API contracts 正则不执行上述 webhook 测试。
范围冻结为既有 workflow、面板构建契约、两份验收记录；Native、低风险、
root 单 writer、external=0，不改变业务行为或发布权限。新增明确专项步骤，
构建契约锁定实际包、正则和执行顺序，保留既有检查且不发布镜像。
本地构建契约 31 项、216 个断言通过，actionlint 与 diff 检查通过。
实际执行新增步骤的 Go 命令，handlers `1.645s`、controlplane `8.765s`
均返回 `ok`，没有空筛选；这仍是本地 SQLite 结果。
完整面板测试链路复跑通过：411 项单测、2491 个断言，另有代理集成
1 项、12 个断言。首轮单测通过但代理集成超时，随后原样单独及完整复跑
均通过，未改断言或放宽 30 秒超时；首轮失败不计为通过。
workflow 补丁随后以 `91f183438` 提交推送，run `41229428442` 四个 job
全部成功；webhook 专项 handlers `0.485s`、controlplane `9.489s`，
没有空筛选。这关闭该 SHA 的专项 CI 执行缺口，不证明 PostgreSQL CI、
跨事务原子性或生产部署。增量只增加 CI 时间，无推理请求或常驻内存开销。

此前 Pi 收到两份验收文档的窄范围实施请求，再次以 `Connection error`、
退出 1 结束且未改文件，root 随后接管文档。未改全局 Pi 配置、切换 provider、
输出凭据或部署生产。原始功能范围、策略 ownership 的人工批准、真实供应商、
完整恢复/升级回滚和生产授权边界不变，原目标继续 **active / PARTIAL**。

后续项 `webhook-audit-postgres-race`：parent 为 `3e6b1f609`，source 为持续上线
目标，reason 为该专项尚缺 PostgreSQL 与 race 运行证据。Native、低风险、
root 单 writer、external=0；范围仅为既有专项测试、运行验证及两份验收记录，
不改业务或外部环境。另补新生成 signing secret 的审计/feed 排除断言，
不改变成功响应按既有合约返回一次性 secret 的行为。
此前 Pi 实施调用仍以 `Connection error`、退出 1 结束且未改文件；
独立检查显示本地认证为 ready，但配置的私网端口 TCP 连接在 5 秒内超时。
ready 不是服务可达或瞬时故障证明，恢复 Pi 服务仍依赖外部状态变化。
新增断言后的 SQLite 33 场景通过（`8.712s`），私有 PostgreSQL 18 同一矩阵
通过（`117.205s`）；此前未加动态 secret 断言的 PostgreSQL 运行也通过
（`113.626s`），不将旧结果替代新断言的验证。harness 确认测试库清理完成，
等待实例正常停止并退出 0，两次 `pg_controldata` 均为 `shut down`。
这不证明真实网络、密码/TLS、生产迁移、崩溃恢复或其他 PostgreSQL 路径。
SQLite 与 race 各有一次因命令配置修正而中止的运行，退出 130，均不计通过
或代码失败；随后复用缓存的 SQLite 复验通过，SQLite `-race` controlplane
矩阵也通过（`52.397s`）。成功 race 使用既有
`.codex-cache/go-build-routing-release-race`；PostgreSQL race、全量 race
和生产性能不在此次证据范围内。

### 单机隔离恢复入口后续项（2026-11-01）

后续项 `single-node-isolated-restore`：parent 为 `single-node-consistent-backup`
（当前交付记录为 `42c990caa`），source 为生产交付门 7，reason 为备份入口虽
已固定产物，但既有手册仍需操作者手工导入数据库和运行文件，缺少目标隔离、
源身份、空卷和恢复中途变化的确定性门禁。Native、中风险、root 单 writer，
加一次独立只读 verifier；明确不使用 Pi agent，范围为恢复脚本、专项回归、
CI/构建契约、部署手册和本记录。

新增 `scripts/production/single-node-restore.sh`。它要求备份目录和目标 Compose
目录物理分离，并要求目标使用不同 project/container/volume 身份；目标必须先
只启动健康 PostgreSQL、创建但不启动网关。入口验证私有目录、固定八个 artifact、
完整 SHA-256 清单和实际 hash，校验 source identity、目标 config 精确一致、
镜像/环境/挂载/标准启动参数、实际容器 ID、local volume driver/scope/options、
不同 Mountpoint，以及目标运行卷和数据库为空。数据库空性检查覆盖用户 namespace、
relation、procedure、type、非 `plpgsql` extension 和其他连接，不只检查
`public` 表；dump list 必须与备份一致，导入使用单事务、遇错退出、无 owner/ACL。

运行文件通过不运行的临时容器和 `docker cp` 导入新卷，避免写入只读
`config.json` 挂载；多次对账 Compose、容器和 config 未变化；失败不自动清理
部分恢复目标，成功清理临时容器后才输出 PASS。归档拒绝绝对/父级路径、重复
条目、条目位于链接下、特殊文件、setuid/setgid 以及逃逸链接图；内部指向归档
普通文件的符号链接和硬链接保留为允许的正向用例。入口不会启动网关、覆盖
config、drop/clean 源库或修改源服务，成功也只表示“导入完成，网关仍停机，
recovery 尚未验证”。

新增回归覆盖源/目标身份交叉复用、换名 bind alias、异常容器/卷/数据库、
导入及清理失败、目标中途变化、校验清单和权限、恶意 tar（含精确双符号链接
图）与内部链接正向路径。最终 fake-Docker 备份/恢复专项、既有预检、
逐文件 Bash 语法、ShellCheck、actionlint、构建契约 31 项/216 个断言和
`git diff --check` 均通过。专属 PostgreSQL 18 Unix-socket 验证覆盖 fresh、
schema、table、sequence、view、function、domain、enum、extension、其他连接
共 10 类空库判定，并完成实际 custom dump 的事务化导入和行对账；实例已正常
停止。本机 Docker daemon 不可用，尚未获得真实 Docker/完整卷恢复、启动后
health/login/Key/Usage/Audit、新写入以及源环境未变化证据。因此本项保持
**PARTIAL**，不替代策略发布、模型治理、MCP 审批/Kill Switch、TLS/供应商和
升级回滚验收。独立只读 verifier 先后指出双符号链接图逃逸与 `ls` 失败被误判
空卷的缺口；现已分别拒绝父级链接目标、显式传播枚举错误，并增加针对性回归。
fake Docker 对空卷检查实际执行原 shell 命令，不再只硬编码成功/失败；
另使用 `ls -Aq` 防止纯换行文件名被命令替换吞掉，并以真实宿主 `ls` 和
换行文件名作为负向回归，仍要求在任何数据导入前拒绝。
修复复核为 `PASS_SCOPED`。PostgreSQL harness 首轮因 `exec` 绕过 shell 函数而
误连 TCP，退出 2，不计通过；改为外部 socket wrapper 后完整复跑通过，
只改变连接位置，不改空性 SQL 或事务化导入参数。该局部验证不证明生产密码、
网络、TLS 或 Docker 集成。

成本仅为恢复期间的顺序 hash/tar 检查、dump list、数据库事务和卷导入，
不改变推理请求路径或常驻内存；磁盘需求为保留的备份加全新目标数据库/运行卷，
Python archive 元数据内存与条目数相关，hash 与 tar 内容按流读取。

后续项 `single-node-restore-ci-portability`：parent 为 `7929ee64b`，
source 为 run `41233217469` 的生产预检失败，reason 为 Runner 没有 `rg`。
该 run 的 panel job 在最终 runtime ownership 断言失败，Docker job 被跳过；
其中两处更早的负向断言也将缺少扫描器误当作无匹配，不能计为安全检查通过。
Native、低风险、root 单 writer、external=0；仅修复专项测试和本记录，
不改生产恢复行为或放宽断言，不使用 Pi agent。扫描改用系统 `grep`，
负向检查显式区分 exit 1（无匹配）与其他错误（失败退出），正向检查仍要求匹配。
本轮在禁用 `rg` 的环境下重新执行全专项，再以新提交的 CI 结果验收；
`7929ee64b` 的失败结果不被本地通过或父提交 CI 覆盖。

该可移植性修复已由 `db0315151` 提交并推送到 `dev`，对应 CI run
`41233788107`（2026-10-31 19:20:53 UTC 创建，19:30:04 UTC 完成）四个 job
全部成功：面板 411 项/2491 断言、员工门户、API contracts
以及 Docker 构建/运行/归档均通过。单机备份/恢复专项实际位于面板 job 的
生产预检步骤，不在 API contracts job 中。候选 artifact ID 为 `13055087290`，
大小 `162921963` 字节，保留至 2026-11-07；runner 报告的镜像 ID 为
`sha256:a884b719b9fcfb8713763188fa1d8ca908c691347ea4539f3f8ca4b5d3a449fa`。
这关闭了缺少 `rg` 时的 CI 执行缺口，但不证明本机 Docker 卷恢复、完整启动后
业务验收、正式 registry 发布、升级回滚或生产切换；本项保持
**PASS_SCOPED / 生产边界 PARTIAL**。

### 候选镜像归档后续项（2026-10-31）

后续项 `panel-ci-candidate-image-artifact`：parent 为 `eef56dbb4`，
source 为 Phase D 固定版本/校验和与交付门 1，reason 为已有 CI 只构建、
加载和运行镜像，job 结束后没有可重新获取的镜像字节。
范围冻结为现有 Docker job、构建契约回归及本记录；Native、低风险、
单 writer。Pi 受明确请求承担实施，但两次只读调用和一次实施调用均以
`Connection error` / 退出码 1 结束且没有改动，终止后由 root 接管。
本地配置检查仅确认默认 deepseek provider 存在凭据，不证明远端可用；
没有更换 provider、打印凭据、部署或把失败调用记为 Pi 实施通过。

Docker job 先将构建标签解析为不可变的 `docker image inspect .Id`，
同一 ID 用于已有运行门及后续导出。仅运行门完整成功才生成
`image.tar.gz`、`provenance.json` 和 `SHA256SUMS`；来源清单仅包含
完整源码 SHA、镜像 ID、OS、架构和归档格式，不导出 inspect 的环境/config
字段或任何运行数据。校验清单覆盖归档和来源清单，生成后要求
`docker image load` 成功，再上传这三个明确文件。
上传名包含源码 SHA、run ID、attempt，保留 7 天；`push: false`、
`contents: read`、原镜像内容和生产授权边界不变。

不能将 `docker image inspect .Id` 一律解释为配置内容哈希，也不能把它
直接作为已发布 registry digest：本次 runner 的 ID 实际匹配归档 OCI
manifest，而 config blob 另有独立哈希。压缩文件 SHA-256 也不是镜像拉取凭据。
归档由 runner 返回的 image ID 导出，
加载后可能没有标签。下载后应先在独立目录执行
`sha256sum --check SHA256SUMS`，核对来源 SHA/目标平台，再用
`docker image load --input image.tar.gz` 载入并按来源清单的 ID 检查。
校验清单只用于完整性，不提供签名或真实性证明。该短期 CI artifact
不是正式发布页或长期回滚库；生产 Compose 仍要求经授权发布后固定的
registry digest，不能把 `image_id` 填作该 digest。

本地测试直接执行工作流中的 Bash，使用模拟 Docker 覆盖正常导出、
非法身份、输出注入、save 部分失败、inspect 身份失配及 load 失败；
核对实际压缩字节、两个文件的 SHA-256、脱敏字段和命令顺序。
最终面板回归为 402 pass / 0 fail（2448 assertions），代理集成另为
1 pass / 0 fail（12 assertions）；Svelte 检查为 0 errors / 0 warnings。
`actionlint`、smoke 脚本 Bash 语法与 `git diff --check` 通过；
独立只读复核为 `PASS_SCOPED`，提交前 clean-code-guard 未发现新增问题。
提交时本机 Docker daemon 缺少 socket，且新候选 CI 尚未完成，因此当时
没有真实 save/load、上传、下载或独立环境启动证据；旧候选 CI 不关闭本项边界。
本增量仅增加 CI 打包磁盘/CPU/短期 artifact 存储，不增加推理请求开销。
生产功能、模型治理、MCP 审批、策略发布、TLS/代理、升级回滚与真实生产
切换仍未完成，总目标继续 **active / PARTIAL**。

后续真实证据：`b5b90cf31` 的 run `41193109692` 四个 job 全部成功；
镜像 smoke、实际 save/load、三个文件上传和 runner 清理均通过。候选
artifact `13040091760` 下载到
`.codex-tmp/candidate-b5b90cf-20261031.GJubay/` 后，两个文件的校验和、
gzip 和 tar 完整读取通过。归档大小 `162913678` 字节、SHA-256 为
`b92f894139991aba9b86292c5052d1fd2a54455c1b03a992cbe9cc36dcdfc9a7`；
来源清单 SHA-256 为
`ec62ff084bf2ef44ac1714a16ba1086887e7cdc7f98fb7a66b49123ef1f68bcc`。
归档所有 8 个 blob 的内容哈希均逐一核对通过；OCI manifest、Docker
兼容清单、config 和 6 个 layer 引用一致，无重复/路径越界成员。
源码 SHA 和 `linux/amd64` 一致，镜像用户为 `1000:0`，`RepoTags` 为 null；
独立 config digest 为
`sha256:987cabf07927247db1ffd048db4c69b6957ebe3820ffe89ea1be5ab5cc7562e7`。
这些证据关闭本候选的远端归档生成、上传、下载和字节完整性边界，
但不是下载后在独立 Docker daemon 中启动或 registry 发布/生产部署证明。
同 SHA 的 Snyk `41193109684` 和 CodSpeed `41193109707` 查询时仍 queued，
不能记为安全扫描或性能通过；既有 setup-go 缓存警告也不代表缓存命中。

本轮另按持续目标重新调用 Pi 实施策略发布/回滚 HTTP 增量，仍以
`Connection error` / 退出 1 结束，没有产生文件。进一步核对现有发布合同后，
确认单机进程 ownership / stop-before-start 约束仍等待人工批准，因此
没有开放任何发布写路由，也没有把只读页面或已完成的内部原语当作发布完成。
本轮为 Native 单 owner、只读验证与文档证据补充，无请求路径开销；
不自动提交、推送、部署或缩减原产品范围。

### 模型目录属性原型键往返修复（2026-10-31）

后续项 `model-catalog-attribute-roundtrip`：parent 为 `b5b90cf31`，
source 为原模型目录与生产完整性目标，reason 为当前序列化复现丢键；
Native 单 writer、低风险、external=0，范围仅为面板 helper、测试和本文。

发现面板模型目录的 `buildModelAttributes` 使用普通对象收集用户自定义
属性；`__proto__` 触发原型 setter，字符串值未形成自有属性，在保存前丢失。
修复改用无原型对象，同时覆盖 `constructor`、`prototype`、`toString`
和 `hasOwnProperty` 等同名键，
保留 Bifrost 上游允许的任意字符串属性键；未改变后端 API、数据库结构、
推理路径或旧 Elygate 兼容范围。

新增回归覆盖五个原型敏感键、空值和服务端属性完整往返。面板定向测试
10 pass / 0 fail（32 assertions），完整面板回归 408 pass / 0 fail
（2470 assertions），代理集成 1 pass / 0 fail（12 assertions），
Svelte 检查 0 errors / 0 warnings，`git diff --check` 通过。
`clean-code-guard: clean`。该修复只关闭属性序列化边界，不等同模型目录
区域、数据等级、能力、健康约束或策略治理完成；本项尚未提交、推送或部署。
本轮 Pi 收到结构化模型目录实施请求后，以 `Connection error` / 退出 1
结束且未产生文件；root 随后只接管上述已复现缺陷。没有自定治理字段的
枚举或强制约束，也不把该修复或失败调用记为 Pi 实施完成。

### 模型目录验证入口修正（2026-10-31）

后续项 `model-catalog-verification-entrypoints`：parent 为 `836f43c06`，
source 为模型目录审计专项与生产验证门，reason 为本地 Go wrapper 的
默认 `go1.27.0` 低于模块要求，且现有 CI 筛选没有包含新目录审计测试。
范围仅为 wrapper、既有面板 CI、构建契约测试和本记录；
Native、低风险、root 单 writer、external=0，不修改业务行为或生产状态。

默认工具链改为 `go1.27.3`，保留调用方的显式工具链覆盖。
三个实际执行 wrapper 的命令夹具覆盖默认、`auto` 和显式版本，
并核对已跟踪的 `core/go.mod`；不依赖干净 checkout 中不存在的 `go.work`。
面板 CI 为 `^TestModelCatalog` 增加独立 handlers/server 步骤，
wrapper 变更本身也会触发该 workflow，保持 `contents: read` 和不发布镜像。

构建契约回归 31 pass / 0 fail（210 assertions），Svelte 检查
0 errors / 0 warnings，Bash 语法、ShellCheck、actionlint 和 diff 检查通过。
真实默认 wrapper 的 `go version` 已输出 `go1.27.3`。
Go 专项使用 `/Volumes/Datas` 下缓存和临时目录及 macOS 外部链接，
等待超过 8 分钟仍停留在链接阶段，随后中止/退出 130，**不计测试通过或失败**。
这不关闭模型目录完整 HTTP/数据库专项边界；新 CI 步骤须以推送后
同一 SHA 的实际运行结果核实，不能用本节本地结果替代。
同 SHA 的 Snyk `41197421464` 和 CodSpeed `41197421344` 查询时仍 queued，
不计安全扫描或性能通过。

本轮按请求调用 Pi 默认 `deepseek/deepseek-v4-flash` 实施，仍以
`Connection error` / 退出 1 结束且未改文件，随后由 root 接管上述可复现缺口；
不将 root 修改记作 Pi 实施成功。后续最小无工具、无项目上下文请求仍然失败；
已配置 provider 目标的独立 TCP 与无凭据 HTTP 读取均超时，
本地 `auth check` 的 ready 状态并非远端连通证明。未修改 Pi 全局配置、
切换 provider、输出凭据或操作该内网服务。
只有构建/CI 工作量增加，无推理请求、数据库或常驻内存开销。
完整功能、真实供应商、备份恢复、升级回滚和生产切换门保持未完成，
原目标继续 active / PARTIAL；本增量没有部署生产。

### 员工后端 CI 空筛选修正（2026-10-31）

后续项 `employee-ci-test-selection`：parent 为 `3c2b96a72`，
source 为 run `41199224310` 的实际 API 日志，reason 为混合正则
`Test(ApplicationKeyRouter|UsageReconciliation|LoginLimiter|Session|Auth|CorsAccessLog)`
不匹配员工包测试名，该包实际零测试执行。范围仅为既有面板 CI、
构建契约测试和本记录；Native、低风险、root 单 writer、external=0，
不修改员工业务、鉴权或数据库行为。

增加独立 `Run employee contracts` 步骤，对 employees 包运行 `^Test`，
涵盖当前源码的全部 47 个顶层测试，包括会话、凭据修改、管理写入、
审计原子性、登录准入和失败事件；保留原混合步骤，不削减其他包的检查。
命令使用独立临时 SQLite，不调用外部模型，不代表 PostgreSQL 或真实网络验收。
构建契约 31 pass / 0 fail（212 assertions）、actionlint 和 diff 检查通过；
新步骤仍需推送后实际执行，不能把已成功的父 run 当作新增员工测试证明。
成本仅为 CI 测试时间，无请求路径或常驻内存开销，原目标继续 active / PARTIAL。

### 员工事务审计关联修复（2026-11-01）

后续项 `employee-audit-correlation`：parent 为 `f7f87ccef`，source 为员工审计
关联缺口复核，reason 为员工管理、登录/退出和自助改密在紧凑审计模式丢失
Request ID / Trace ID，签名模式也未统一采用控面的来源和校验规则。Native、
中风险、root 单 writer，并完成一次独立只读 verifier；明确不使用 Pi agent。

新增 `controlplane.AuditCorrelationFromRequest` 窄桥接，复用现有来源优先级、
ASCII/小写 hex 校验和 `strings.Clone` 冻结逻辑。员工管理与 self-service appender
在创建时捕获关联；compact 与 signed 审计写入同一组值，仍使用 caller transaction。
匿名失败登录继续不接收 request 关联，身份、授权、审计 schema 和事务边界未改变。

新增回归覆盖 admin/self-service、compact/signed、来源优先级、非法值不回退、
捕获后 request mutation、原始签名表字段及事务回滚；员工登录/退出与改密路由也
断言关联字段，匿名失败登录断言伪造 header/context/response 仍不落库。
旧实现 overlay 已先红；当前定向 server 测试、control-plane correlation 测试、
`-race` 定向测试、`go vet`（server/controlplane）及 `git diff --check` 通过。
本轮使用隔离 SQLite 和进程内真实路由，不代表 PostgreSQL、真实网络或生产验收。
构建契约 31 pass / 0 fail、218 assertions，actionlint 与独立复核通过。

员工管理 appender capture 基准（Apple M4、Go 1.27.3，`-benchtime=1s`；
同一测试的旧 HEAD overlay 与当前实现，数值为前 / 后）：

| 模式/输入 | ns/op | B/op | allocs/op |
| --- | --- | --- | --- |
| compact/absent | 108.1 / 136.3 | 248 / 288 | 2 / 2 |
| compact/present | 98.69 / 158.7 | 264 / 336 | 3 / 4 |
| compact/invalid | 111.6 / 145.9 | 392 / 432 | 3 / 3 |
| signed/absent | 107.8 / 144.8 | 256 / 256 | 2 / 2 |
| signed/present | 98.48 / 158.7 | 272 / 304 | 3 / 4 |
| signed/invalid | 114.6 / 145.3 | 400 / 400 | 3 / 3 |

该基准不含数据库写入或签名运算。增量是员工 appender 创建时的来源校验与
字符串冻结，不进入推理请求路径；没有新增缓存，两个关联标识最多持有
160 字节字符串内容，随 appender 生命周期释放，不捕获 RequestCtx。

CI 增加独立 `Run employee audit correlation regressions` 步骤；必须在推送后以
同一 SHA 实际执行，不能把本地或父 run 结果替代 CI 证据。本机 Docker 缓存探针
此前仍超时，未重跑完整恢复；生产路由发布、真实凭据、整机恢复和最终切换授权
继续未完成，原目标保持 **active / PARTIAL**。

### 单机模板镜像固定检查（2026-10-31）

后续项 `single-node-postgres-image-pin`：parent 为 `edc1a1c08`，source 为交付门 2，
reason 为模板仍使用可漂移的数据库标签。Native、root 单 writer、低风险、
external=0；仅修改模板和记录，不涉及生产写入、部署或推理路径。

`examples/single-node-postgres/docker-compose.yml` 现将 PostgreSQL 固定为
`postgres:16-alpine@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`。
Docker registry manifest 查询确认该 digest 对应多架构镜像，Compose 配置解析、
健康依赖、持久化卷、只读配置挂载及六项必填环境变量缺失拒绝均通过。
本机 OrbStack/Docker daemon 当前不可用，因此没有把实际镜像构建、启动、健康检查
或非 root 运行误报为已完成；`ELYGATE_IMAGE` 仍必须由部署环境提供最终固定 digest。

1. 固定最终代码 SHA、Bun/Go 工具链、平台架构、镜像 digest 和校验和。
   对最终镜像进行实际构建、启动、非 root 权限和健康检查。
2. 使用 [单机 PostgreSQL 模板](../../examples/single-node-postgres/docker-compose.yml)
   审阅脱敏配置。替换所有占位符；数据库与网关都固定镜像版本。
   密钥由部署环境注入，禁止将 `.env`、dump、连接串或 Cookie 纳入提交和日志。
3. 在隔离目标完成全新安装和数据库迁移。记录配置库与日志库的实际后端，
   `/health` 必须通过已配置存储检查，不以进程仍在运行为成功。
4. 验证首次管理员设置、匿名管理请求拒绝、真实登录与退出、
   Origin、Application Key 和选定策略模式。
   `ELYGATE_APPLICATION_BINDING_MODE=required` 不等于强制所有请求携带 Key，
   还需独立核实上游 inference authentication 配置。
5. 核实反向代理 TLS、SSE 不缓冲和 WebSocket 升级；
   只有经过审阅的入口可对外开放。配置日志保留、磁盘监控与告警。
6. 使用测试账户验证真实模型、MCP、Relay、预算告警、审计和账本；
   记录测试数据归属和清理，不向生产业务数据注入合成记录。
7. 对配置库、原始日志库、配置文件、上传文件和必要密钥材料建立一致备份。
   在独立数据库/目录恢复并对账 Key 绑定、用量与审计，再证明恢复后可写。
   局部控制面数据库恢复不等于整机恢复。
8. 演练升级和回滚。记录旧镜像 digest、迁移版本、备份时间点及回滚条件；
   有不兼容迁移时，不能只回退镜像。不可在唯一生产库上试验恢复。
9. 生产切换前重新确认目标、窗口、回滚负责人和显式授权。
   准备工作、测试通过或旧部署记录均不构成新的生产写入授权。

只有最终候选的全部必需证据已归档、所有阻断项已解决，
才能将此清单改为可发布；本地通过、CI 通过、镜像通过和生产验收是不同边界。
