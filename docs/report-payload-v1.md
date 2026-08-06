# ReportPayloadV1

`ReportPayloadV1` 是第一阶段静态 JSON 与第二阶段正式接口共用的数据契约。金额统一为人民币元，比例统一为小数（例如 `0.681` 表示 `68.1%`），时间使用带 `+08:00` 的 ISO 8601 字符串。

## 顶层结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `1` | 数据契约版本 |
| `campaign` | `string` | 战报名称 |
| `generatedAt` | `string` | 快照成功生成时间 |
| `timezone` | `"Asia/Shanghai"` | 页面业务时区 |
| `freshness` | `object` | 数据新鲜度、延迟阈值和提示 |
| `source` | `object` | 数据来源与BI汇总对账结果 |
| `defaults` | `object` | 默认视角、口径和示范门店 |
| `hq` | `object` | 总部汇总 |
| `summary` | `object` | 快速榜单和区域状态摘要 |
| `regions` | `Region[]` | 全部区域 |
| `stores` | `Store[]` | 全部门店 |

## 总部 `hq`

- `storeCount`、`activeStoreCount`、`bonus`
- `cumulative.amount/orderCount/targetOrderCount/orderCompletionRate`
- `cumulative.targets.bet/drive/challenge`
- `cumulative.rates.bet/drive/challenge`
- `today.amount/orderCount/targetOrderCount/orderCompletionRate/targetAmount/completionRate`
- `delta30`、`todayDelta30`：不可计算时为 `null`
- `trend[]`：最近5个成功快照的 `{ at, amount }`

## 区域 `Region`

- 身份：`id`、`name`、`managerName`、`storeCount`
- 排名：`ranking.cumulativeChallenge`、`ranking.todayChallenge`
- 累计：`cumulative.amount/targets/rates/bonus`
- 今日：`today.amount/orderCount/targetOrderCount/orderCompletionRate/targetAmount/completionRate`
- 变化：`delta30`、`todayDelta30`、`trend[]`

第一阶段没有可靠区域经理字段时，`managerName` 必须为 `null`，页面只按区域督促。

## 门店 `Store`

- 身份：`id`、`name`、`regionId`、`regionName`、`status`
- 奖励：`bonus`、`tierOrders`
- 排名：`ranking.cumulativeChallenge`、`ranking.todayChallenge`
- 累计：`cumulative.amount/orderCount/targetOrderCount/orderCompletionRate/targets/rates`
- 今日：`today.amount/orderCount/targetOrderCount/orderCompletionRate/targetAmount/completionRate`
- 变化：`delta30`、`todayDelta30`、`rankChange30`、`trend[]`

## 摘要 `summary`

- `deltaBasis`：`waiting-for-next-snapshot` 或 `snapshot-comparison`
- `fastestStoreIds`：近30分钟增长最快3家门店ID
- `attentionStoreIds`：重点督促3家门店ID
- `completedRegionIds`：今日目标已达成区域ID
- `lowestRegionId`：今日达成率最低区域ID
- `noGrowthStoreCount`、`noGrowthRegionCount`：无可比快照时为 `null`

## 第二阶段接口

### `GET /api/v1/reports/806/latest`

返回完整 `ReportPayloadV1`。建议同时返回 `ETag`，并以 `Cache-Control: private, no-store` 避免敏感数据被共享缓存。

### `GET /api/v1/reports/806/history`

建议查询参数：`from`、`to`、`interval=30m`、可选 `storeId`／`regionId`。响应至少提供可重建最近趋势和30分钟比较所需的时间点。

正式接口必须增加登录鉴权、角色范围授权、访问日志和稳定主键。前端遇到接口失败时保留最后一次成功结果，并显示“数据已延迟”，不能把金额或达成率清零。
