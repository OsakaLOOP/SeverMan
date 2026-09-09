# 爱发电官方文档索引

核对日期：2026-09-09。全文暂存 `.research/afdian-*.txt`。文章之间的相关链接已读取；文档旧站 `guide.ifdian.net` 当日 DNS 无法解析，接口依据当前官方文章。

## [开发者功能汇总](https://ifdian.net/p/010ff078177211eca44f52540025c377)

1. 前端嵌入、按钮或 Widget
   - 嵌入页面
   - 按钮
2. URL 参数
   - 例如：方案、月数、留言和 custom_order_id
3. 爱发电 API
4. OAuth2 关联授权
   - 效果
   - 申请
5. 爱发电与 Discord 自动化
6. 爱发电与 Kook 或 Discord 类产品联动自动化

## [Webhook 与 API 文档](https://ifdian.net/p/9c65d9cc617011ed81c352540025c377)

1. Webhook、API、OAuth2 关联授权概述
2. Webhook
   - 说明、订单通知和成功响应
   - 签名介绍：RSA 公钥、签名字段、SHA256 校验与样例
3. API
   - 签名介绍
   - 签名计算示例
   - JSON 请求示例
   - 检验签名是否准确：ping
   - ts 过期示例
   - 成功结构
   - ec 字段异常错误码
4. 具体接口列表
   - query-order：page、out_trade_no、per_page、返回结构
   - 查赞助者 query-sponsor：page、per_page、user_id、返回结构
5. 字段说明
   - 订单
   - 赞助者
6. OAuth2 关联授权
   - 应用申请
   - 整体流程
   - 获取用户 ID：服务端授权码交换
7. 更新（2025 年 5 月 14 日）
   - query-random-reply：按订单查询自动回复
   - update-plan-reply：自动回复、随机回复、追加与覆盖
8. 更新（2025 年 7 月 1 日）
   - Webhook 增加签名
9. 更新（2025 年 8 月 14 日）
   - Open API 签名
   - send-msg：发送私信与频率限制
   - query-plan：方案、永久属性、周期与 SKU
