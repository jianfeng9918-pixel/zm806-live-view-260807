# 周麻婆 806 储值战报 V1

面向手机查看的内部战报网页。查看范围采用两级选择：先选总部或区域；选择区域后，再选区域总览或该区域门店。页面会在当前设备记住上次查看的范围与今日／累计口径。

在线访问：https://jianfeng9918-pixel.github.io/zhoumapo-806-battle-report/

当前交付包示例数据快照：2026-08-07 10:26（Asia/Shanghai），共 130 家门店、13 个区域，今日储值 ¥44,020、累计储值 ¥3,280,684。该快照仅用于页面与字段验证；正式上线后应由技术中心接口持续提供最新数据。

## 当前包含

- 手机交互：两级范围选择、清晰的今日／累计按钮，并在本机自动恢复上次查看的门店和数据口径。
- 总部：全公司储值、达成率、近 30 分钟新增、参与门店、区域今日达成、最快／待督促门店和完整排行榜。
- 区域：区域储值、目标达成、区域排名、区域内最快／待督促和门店列表。
- 门店：储值金额、全国及区域排名、超越上一名所需金额、三档目标达成率、奖金、趋势和详细指标。
- 竞赛激励：按今日／累计分别展示30分钟排名变化；全国或区域第一使用克制的冠军首屏。
- 防误触：底部门店总表只用于浏览，切换门店使用顶部选择器或快捷榜单。
- 保护提示：关闭普通文本选择和右键菜单，不提供复制、下载或导出入口，并显示“内部只读”及更新时间。公开网页无法真正阻止截图或开发者工具读取。

## 本地查看

```bash
npm ci
npm run dev -- --port 4173
```

完整交付检查：

```bash
npm run verify
```

## 第一阶段：人工更新

第一阶段不是无人值守刷新。每半小时由用户保持 BI 登录并通知 Codex 更新，Codex完成以下流程：

1. 从看板15只导出操作手册指定的5张门店／区域表，再从看板16只导出2张职能／集团校验表。
2. 将两份工作簿保存到忽略上传的 `data/raw/`。
3. 运行解析命令，生成本地历史快照和公开 `report.json`：

   ```bash
   npm run data:update -- \
     --input data/raw/806-store-export-YYYYMMDD-HHmm.xlsx \
     --functional-input data/raw/806-functional-export-YYYYMMDD-HHmm.xlsx \
     --generated-at YYYY-MM-DDTHH:mm:ss+08:00
   ```

4. 运行 `npm run verify`。成功后提交并推送；GitHub Actions 自动发布。

原始 Excel 与 `data/snapshots/` 不进入公开仓库。更新失败时不要覆盖 `public/data/report.json`，线上继续显示最后一次成功数据。

完整操作说明见 [docs/BI刷新操作手册.md](docs/BI刷新操作手册.md)。

## 第二阶段：接口迁移

技术中心提供：

- `GET /api/v1/reports/806/latest`
- `GET /api/v1/reports/806/history`

接口继续返回 `ReportPayloadV1`。前端只需把 `fetch(data/report.json)` 替换为接口适配器，页面与计算口径不重做。正式接口应补充稳定的 `storeId`、`regionId`、`managerName`、鉴权和访问日志。

字段定义见 [docs/report-payload-v1.md](docs/report-payload-v1.md)，视觉验收见 [design-qa.md](design-qa.md)。

日华／技术中心同步 V1.1 时，请同时查看 [docs/日华接入变更说明_V1.1.md](docs/日华接入变更说明_V1.1.md)。

本次完整交接摘要见 [docs/日华交接说明_20260807.md](docs/日华交接说明_20260807.md)。

## 数据公开边界

GitHub Pages 与公开仓库中的 `public/data/report.json` 对所有获得链接的人可读。它适合本轮快速验证，不等同于权限控制；如数据不应公开，应在第二阶段改为鉴权接口或私有托管。
