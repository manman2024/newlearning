> **Status: implemented.** This is the original Waffo vendor change notice
> (2026-09-06, Chinese). The template already reflects it:
> `subscription.payment_succeeded` is ignored, `subscription.activated` stores
> the first period, and `subscription.renewed` / `subscription.recovered`
> advance it (`src/payment/provider/waffo.ts`, registered by default in
> `scripts/setup-waffo.ts`). Kept for reference; the notice's optional
> suggestions (per-period history ledger, backfilling) are intentionally not
> implemented — only the latest period is stored.

---

WEBHOOK 变更通知 · BREAKING CHANGE

subscription.payment_succeeded
webhook 字段变更

各位商户开发者：

自 2026-09-06 起，subscription.payment_succeeded webhook 的 data 中不再包含以下四个字段：billingPeriod、currentPeriodStart、currentPeriodEnd、orderStatus。订阅周期信息已迁移至专门的生命周期事件。请依赖这些字段的商户按本公告调整接入。

一、如何获取某笔付款对应的订阅周期

首次付款：订阅激活时会同时投递 subscription.activated 事件，其 payload 包含首个计费周期的 billingPeriod / currentPeriodStart / currentPeriodEnd，请通过 orderId 与付款回调关联。

续费付款：请在商户后台「Webhook 设置」中勾选新增的 subscription.renewed 事件（不勾选则不会投递）。该事件仅在续费扣款成功后投递，payload 携带续费后新周期的完整字段。

二、subscription.renewed 事件说明

仅覆盖续费；首次付款仍使用 subscription.activated + subscription.payment_succeeded，不会触发 renewed。

续费成功时，事件 payload 示例如下：

```
{
  "id": "ORD_xxxxxxxxxxxxxxxxxxxxxx",
  "eventId": "ORD_xxxxxxxxxxxxxxxxxxxxxx-renewed-2026-10-08",
  "eventType": "subscription.renewed",
  "mode": "prod",
  "storeId": "STO_xxxxxxxxxxxxxxxxxxxxxx",
  "storeName": "Your Store",
  "timestamp": "2026-09-08T04:20:43.300Z",
  "data": {
    "orderId": "ORD_xxxxxxxxxxxxxxxxxxxxxx",
    "orderStatus": "active",
    "billingPeriod": "monthly",
    "currentPeriodStart": "2026-09-08",
    "currentPeriodEnd": "2026-10-08",
    "amount": "3.99",
    "subtotal": "3.99",
    "taxAmount": "0.00",
    "total": "3.99",
    "currency": "USD",
    "taxName": "None",
    "taxRate": 0,
    "buyerEmail": "buyer@example.com",
    "merchantProvidedBuyerIdentity": "your-user-id",
    "orderMerchantExternalId": "your-external-order-id",
    "orderMetadata": { },
    "productMetadata": { },
    "productName": "Monthly-VIP",
    "productDescription": "...",
    "billingDetail": { "country": "US", "isBusiness": false }
  }
}
```

↑ 高亮三行即本次从 subscription.payment_succeeded 迁出、改由生命周期事件携带的周期字段。

三、历史账期查询

订单查询接口返回的 currentPeriodStart / currentPeriodEnd 为订阅当前最新周期，会随续费滚动更新；目前没有按付款 ID 回查该笔付款对应历史账期的接口。请在收到 subscription.activated / subscription.renewed 事件时自行持久化各周期起止。

对 9/6 之后、接入 renewed 之前缺失周期的存量付款，可按「周期起始日 = 付款日（paymentDate），周期长度 = 商品计费周期」近似回补。