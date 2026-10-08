# Stage 3 成员角色管理规则对照

检查时间：2026-10-08 UTC  
隔离 API：`http://127.0.0.1:13074`  
客户端提交：待本轮提交生成

## Web/API 规则

| 场景 | Web 规则来源 | API 行为 | 本轮移动端行为 |
|---|---|---|---|
| owner 操作成员 | `packages/web/src/components/member/humanRoleTransitions.ts` 使用 `canTransitionServerRole`；owner 可将非自身成员改为 owner/admin/member | `PATCH /api/servers/:id/members/:memberId`；服务端再次校验角色转换 | 成员卡片显示“设为所有者/管理员”；目标为唯一 owner 时不显示降级到 admin/member |
| owner 操作 admin | owner 可降为 member，也可升为 owner | 服务端校验并广播 `server:member-updated` | 显示可用角色动作，PATCH 后重新 GET 成员列表 |
| admin 操作 member | 仅允许 member → admin | 非允许转换返回 403 | 仅显示“设为管理员” |
| admin 操作 owner/admin | 不允许降级或同级修改 | 服务端返回 403 | 不显示角色动作 |
| member/guest 操作角色 | 不允许 | 服务端返回 403 | 不显示角色动作 |
| 当前用户自身 | Web 编辑器不提供自我角色操作；服务端拒绝自我降级 | 服务端拒绝不安全转换 | 移动端排除当前用户 |
| 最后一个 owner | 不得降级，服务器必须保留至少一个 owner | 服务端返回 400 `A server must have at least one owner` | 移动端不显示该降级动作 |
| guest | 由 guest feature flag 控制；本轮不开放 guest admission | API 仅在 gate 开启时接受 guest | 移动端默认关闭 guest 选项 |

## 客户端实现

- `stage3Api.ts` 新增 `updateServerMemberRole()`，调用现有 PATCH 契约。
- `stage3Navigation.ts` 新增 `getEditableStage3MemberRoles()`，复制 Web/API 的目标感知矩阵，并排除当前用户及唯一 owner 降级。
- `Stage3Navigator.tsx` 的成员卡片显示中文角色、可用角色动作和刷新入口；PATCH 成功后重新读取成员列表，避免只依赖本地乐观状态。
- 成员增删、guest admission、真实成员和唯一管理员/owner 操作仍未纳入本轮。

## 隔离 API 证据

`/tmp/raft-mobile-test/member-role-isolated-evidence.json`：

- 专用隔离成员初始 `member`。
- member 身份尝试 `PATCH self → admin`：HTTP 403，`Only server owners and admins can change member roles`。
- owner 身份 `PATCH member → admin`：HTTP 200，随后 GET 回读 `admin`。
- owner 身份恢复 `PATCH admin → member`：HTTP 200，随后 GET 回读 `member`。

本轮只访问 `127.0.0.1:13074`，未访问或修改生产 API、数据库、Redis、APNs。
