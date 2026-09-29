/* ============================================================
   出入登记表 · 数据访问层
   所有对 Supabase 的调用都收敛在这里，页面逻辑不直接碰 SDK
   ============================================================ */
(function (global) {
  "use strict";

  var cfg = global.__APP_CONFIG__ || {};
  var client = null;

  function isConfigured() {
    return !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  }

  function init() {
    if (!isConfigured()) return false;
    if (client) return true;
    if (!global.supabase || !global.supabase.createClient) {
      throw new Error("Supabase SDK 未加载，请检查网络或 CDN");
    }
    client = global.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { "x-client-info": "visit-register/1.0" } }
    });
    return true;
  }

  // 把 Postgres / 网络错误翻译成中文提示
  function humanize(error) {
    if (!error) return "未知错误";
    var msg = String(error.message || error);
    if (msg.indexOf("DUPLICATE_SUBMIT") > -1) return "DUPLICATE_SUBMIT";
    if (msg.indexOf("INVALID_TOKEN") > -1) return "INVALID_TOKEN";
    if (msg.indexOf("RECORD_NOT_FOUND") > -1) return "RECORD_NOT_FOUND";
    if (msg.indexOf("Failed to fetch") > -1 || msg.indexOf("NetworkError") > -1) {
      return "网络连接失败，请检查手机网络后重试";
    }
    if (error.code === "23514") return "填写内容不符合要求，请检查后重试";
    return msg;
  }

  /* ---------------- 访客：提交登记 ---------------- */
  // 注意：这里刻意只传访客能填的字段。
  // arrived_at 由数据库默认值生成，left_at / confirmed_by 由 RLS 策略强制为空，
  // 访客无法伪造系统记录的到达时间，也无法把自己标成"已离开"。
  function submitRegistration(payload) {
    var row = {
      name: String(payload.name || "").trim().slice(0, 30),
      phone: normalPhone(payload.phone),
      org: trimOrNull(payload.org, 60),
      room: trimOrNull(payload.room, 40),
      reason: trimOrNull(payload.reason, 80),
      // 到访时间由访客填写（可改），格式 YYYY-MM-DDTHH:mm，直接存 timestamptz
      visit_time: normalizeLocalTime(payload.visit_time),
      receptionist: trimOrNull(payload.receptionist, 30),   // 访问人：被访者 / 接待方
      remark: trimOrNull(payload.remark, 60)
    };
    return insertRow(row, true);
  }

  // 插入一条记录。
  //
  // 【重要】这里刻意不使用 .select()。
  //   PostgREST 的 .select() 会让 INSERT 带上 RETURNING，也就是插入后回读这条记录；
  //   而回读需要 SELECT 权限 + SELECT 策略。本方案刻意不给 anon 任何 SELECT 策略
  //   （防止访客读到别人的手机号），因此带 RETURNING 的插入会被策略拒绝，
  //   报错信息是 "new row violates row-level security policy"——插入其实成功了，
  //   是回读那一步失败导致整个请求报错。
  //   不带 RETURNING 时 PostgREST 返回 201，插入正常完成。
  //
  // 另一个保护：数据库若还没执行加列脚本（缺 visit_time / receptionist），
  // 自动去掉这两个字段重试一次，保证访客仍能登记。
  function insertRow(row, allowFallback) {
    return client
      .from("visitors")
      .insert(row)
      .then(function (res) {
        if (res.error) {
          var msg = String(res.error.message || "");
          var missingColumn = res.error.code === "PGRST204"
            || /column .* does not exist/i.test(msg)
            || /Could not find the '.*' column/i.test(msg)
            || /schema cache/i.test(msg);
          if (allowFallback && missingColumn) {
            var slim = {};
            Object.keys(row).forEach(function (k) {
              if (k !== "visit_time" && k !== "receptionist") slim[k] = row[k];
            });
            return insertRow(slim, false);
          }
          throw new Error(humanize(res.error));
        }
        // 不回读记录，直接返回提交的内容供成功页展示
        return { ok: true, submitted: row };
      });
  }

  // <input type="datetime-local"> 给的是 "2026-09-30T09:15"，本地时区含义
  function normalizeLocalTime(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
    return s.length === 16 ? s + ":00" : s;
  }

  function normalPhone(v) {
    var s = String(v || "").replace(/[\s\-]/g, "");
    return s ? s.slice(0, 20) : null;
  }
  function trimOrNull(v, max) {
    var s = String(v == null ? "" : v).trim();
    return s ? s.slice(0, max) : null;
  }

  /* ---------------- 管理端 ---------------- */
  function adminList(token, opts) {
    opts = opts || {};
    return client
      .rpc("admin_list", {
        p_token: token,
        p_from: opts.from || null,
        p_to: opts.to || null,
        p_only_in: !!opts.onlyIn,
        p_limit: opts.limit || 500
      })
      .then(function (res) {
        if (res.error) throw new Error(humanize(res.error));
        return res.data || [];
      });
  }

  function adminMarkDeparture(token, id, leftAtISO, confirmedBy) {
    return client
      .rpc("admin_mark_departure", {
        p_token: token,
        p_id: id,
        p_left_at: leftAtISO,
        p_confirmed_by: confirmedBy || null
      })
      .then(function (res) {
        if (res.error) throw new Error(humanize(res.error));
        return res.data;
      });
  }

  function adminUpdate(token, id, patch) {
    return client
      .rpc("admin_update", { p_token: token, p_id: id, p_patch: patch })
      .then(function (res) {
        if (res.error) throw new Error(humanize(res.error));
        return res.data;
      });
  }

  function adminDelete(token, id) {
    return client
      .rpc("admin_delete", { p_token: token, p_id: id })
      .then(function (res) {
        if (res.error) throw new Error(humanize(res.error));
        return res.data;
      });
  }

  // 用一条最轻量的读取来验证口令是否正确
  function verifyToken(token) {
    if (!token) return Promise.resolve(false);
    return adminList(token, { limit: 1 })
      .then(function () { return true; })
      .catch(function (e) {
        if (String(e.message).indexOf("INVALID_TOKEN") > -1) return false;
        throw e;
      });
  }

  global.RegLib = {
    isConfigured: isConfigured,
    init: init,
    submitRegistration: submitRegistration,
    adminList: adminList,
    adminMarkDeparture: adminMarkDeparture,
    adminUpdate: adminUpdate,
    adminDelete: adminDelete,
    verifyToken: verifyToken,
    humanize: humanize
  };
})(window);
