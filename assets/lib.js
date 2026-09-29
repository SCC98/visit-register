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
  // 访客无法伪造到达时间，也无法把自己标成"已离开"。
  function submitRegistration(payload) {
    var row = {
      name: String(payload.name || "").trim().slice(0, 30),
      phone: normalPhone(payload.phone),
      org: trimOrNull(payload.org, 60),
      room: trimOrNull(payload.room, 40),
      reason: trimOrNull(payload.reason, 80),
      remark: trimOrNull(payload.remark, 60)
    };
    return client
      .from("visitors")
      .insert(row)
      .select("id, name, arrived_at, room")
      .single()
      .then(function (res) {
        if (res.error) throw new Error(humanize(res.error));
        return res.data;
      });
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
