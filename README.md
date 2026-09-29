# 访客出入登记表

手机扫码自助登记，数据存 Supabase，页面托管在 GitHub Pages。

**访客登记地址**：https://scc98.github.io/visit-register/

## 使用方式

| 角色 | 地址 |
|---|---|
| 访客 | `https://scc98.github.io/visit-register/` |
| 管理员 | `https://scc98.github.io/visit-register/?admin=你的管理口令` |

- 访客扫码后填写姓名、手机号（必填）与单位、房间、事由（选填）
- 到达时间由系统自动记录，访客无法伪造
- 访客离开时，管理员在后台点「记录离开」
- 后台支持筛选（今天 / 近 7 天 / 未离开 / 全部）、搜索、修改、删除
- 导出 Excel（CSV），带 UTF-8 BOM，中文不乱码

## 安全设计

- 数据库只给匿名用户 **insert** 权限，没有任何 select / update / delete 策略
  → 访客即使拿到网址，也读不到任何记录和手机号
- 插入时强制 `arrived_at = now()`，且 `left_at` / `confirmed_by` 必须为空
  → 访客无法伪造到达时间，也无法把自己标成「已离开」
- 管理端读写全部走 `security definer` 数据库函数，函数内先校验口令
- 管理口令只存 SHA-256 哈希，数据库里没有明文

## 文件说明

```
index.html            页面结构（访客端 + 管理端 + 登录页）
assets/style.css      全部样式
assets/lib.js         数据访问层
assets/app.js         页面逻辑
assets/config.js      连接配置（公开信息，可安全暴露给浏览器）
.nojekyll             禁止 GitHub 的 Jekyll 处理，否则部分文件会被忽略
```

## 说明

`assets/config.js` 里的 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 是**公开信息**，
会随网页发送给浏览器，这是 Supabase 的设计，安全性由数据库的 RLS 策略保证。
**不要**把 `service_role` key 放进来。

`index.html` 里对 Supabase SDK 做了三层 CDN 兜底（jsdelivr → unpkg → esm.sh），
以应对单个 CDN 被网络干扰的情况。
