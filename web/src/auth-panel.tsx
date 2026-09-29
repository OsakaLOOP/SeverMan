import React, { useReducer, useState } from "react";
import { Boxes } from "lucide-react";
import { auth } from "./auth-client.js";

type Screen = "signin" | "signup" | "pending" | "forgot" | "reset" | "verify-result" | "totp" | "backup";
type State = { screen: Screen; email: string; error: string; notice: string };
type Action = { type: "screen"; screen: Screen; notice?: string } | { type: "email"; email: string } | { type: "error"; error: string } | { type: "notice"; notice: string };
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "screen": return { ...state, screen: action.screen, error: "", notice: action.notice ?? "" };
    case "email": return { ...state, email: action.email };
    case "error": return { ...state, error: action.error, notice: "" };
    case "notice": return { ...state, notice: action.notice, error: "" };
  }
}
const errors: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码不正确，请重试或找回密码。",
  INVALID_PASSWORD: "密码不正确。",
  INVALID_TOKEN: "验证链接无效，请重新发送验证邮件。",
  TOKEN_EXPIRED: "验证链接已过期，请重新发送验证邮件。",
  INVALID_TWO_FACTOR_COOKIE: "二次验证已过期，请重新登录。",
  INVALID_TWO_FACTOR_CODE: "验证码不正确，请重试。",
};
function check(result: { error?: { code?: string; message?: string; status?: number } | null }) {
  if (result.error?.status === 429) throw new Error("操作过于频繁，请稍后再试。");
  if (result.error) throw new Error(errors[result.error.code ?? ""] ?? result.error.message ?? "请求失败，请稍后重试。");
}
const titles: Record<Screen, string> = { signin: "登录", signup: "创建账号", pending: "等待邮箱验证", forgot: "找回密码", reset: "设置新密码", "verify-result": "邮箱验证结果", totp: "二次验证", backup: "使用恢复码" };

export function AuthPanel({ github, onAuthenticated }: { github: boolean; onAuthenticated: () => Promise<void> }) {
  const [state, dispatch] = useReducer(reducer, {
    screen: location.pathname === "/sign-up" ? "signup" : location.pathname === "/reset-password" ? "reset" : location.pathname === "/verify-result" ? "verify-result" : "signin",
    email: "", error: "", notice: "",
  });
  const [busy, setBusy] = useState(false);
  const params = new URLSearchParams(location.search);
  const verificationError = params.get("error");
  const verified = params.get("verified") === "1" && !verificationError;
  const callbackURL = `${location.origin}/verify-result?verified=1`;
  function go(screen: Screen, notice?: string) {
    const path = screen === "signup" ? "/sign-up" : "/sign-in";
    window.history.replaceState({}, "", path);
    dispatch({ type: "screen", screen, notice });
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true); dispatch({ type: "notice", notice: "" });
    try { await fn(); } catch (error) { dispatch({ type: "error", error: error instanceof Error ? error.message : "请求失败" }); }
    finally { setBusy(false); }
  }
  async function resend() {
    check(await auth.sendVerificationEmail({ email: state.email, callbackURL }));
    dispatch({ type: "notice", notice: "若该邮箱尚未验证，验证邮件已提交发送；已验证账号可直接登录。请同时检查垃圾邮件。" });
  }
  async function submit(data: FormData) {
    const password = String(data.get("password") ?? "");
    if (state.screen === "pending" || state.screen === "verify-result") return resend();
    if (state.screen === "forgot") {
      check(await auth.requestPasswordReset({ email: state.email, redirectTo: `${location.origin}/reset-password` }));
      dispatch({ type: "notice", notice: "若邮箱已注册，密码重置邮件已提交发送。" }); return;
    }
    if (state.screen === "reset") {
      if (!params.get("token") || params.has("error")) throw new Error("重置链接无效或已过期，请重新找回密码。");
      check(await auth.resetPassword({ newPassword: password, token: params.get("token")! }));
      go("signin", "密码已更新，请使用新密码登录。"); return;
    }
    if (state.screen === "totp" || state.screen === "backup") {
      check(await (state.screen === "backup" ? auth.twoFactor.verifyBackupCode({ code: String(data.get("code")) }) : auth.twoFactor.verifyTotp({ code: String(data.get("code")) })));
      await onAuthenticated(); return;
    }
    if (state.screen === "signup") {
      const result = await auth.signUp.email({ email: state.email, password, name: String(data.get("name")), callbackURL });
      check(result);
      if (result.data?.token) { await onAuthenticated(); return; }
      dispatch({ type: "screen", screen: "pending", notice: "请通过邮件链接验证邮箱后登录。若此邮箱已注册，请直接登录或找回密码。" });
      return;
    }
    // Session ownership is confirmed by /v1/me before entering the workspace.
    // No callbackURL here: an automatic redirect races session loading and errors.
    const result = await auth.signIn.email({ email: state.email, password });
    if (result.error?.code === "EMAIL_NOT_VERIFIED") {
      dispatch({ type: "screen", screen: "pending", notice: "邮箱尚未验证，请查收邮件，或重新发送。" }); return;
    }
    check(result);
    if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
      dispatch({ type: "screen", screen: "totp" }); return;
    }
    await onAuthenticated();
  }
  const twoFactor = state.screen === "totp" || state.screen === "backup";
  const verification = state.screen === "pending" || state.screen === "verify-result";
  return <main className="auth-page"><div className="brand"><Boxes size={28} /><strong>SM 服务中心</strong></div><section className="auth-form">
    <span className="eyebrow">统一账号</span><h1>{titles[state.screen]}</h1>
    {state.error && <div role="alert" className="error">{state.error}</div>}
    {state.notice && <div role="status" className="notice">{state.notice}</div>}
    {state.screen === "verify-result" && <div role={verificationError ? "alert" : "status"} className={verificationError ? "error" : "notice"}>{verificationError ? (errors[verificationError] ?? "邮箱验证失败，请重新发送验证邮件。") : verified ? "邮箱验证成功，请登录。" : "请先通过邮件中的验证链接完成验证，再登录确认账号状态。"}</div>}
    {!(state.screen === "verify-result" && verified) && <form key={state.screen} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void run(() => submit(data)); }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {state.screen === "signup" && <label>昵称<input name="name" autoComplete="nickname" required maxLength={100} /></label>}
        {!twoFactor && state.screen !== "reset" && <label>邮箱<input name="email" type="email" autoComplete="email" required value={state.email} onChange={e => dispatch({ type: "email", email: e.target.value })} /></label>}
        {["signin", "signup", "reset"].includes(state.screen) && <label>密码<input name="password" type="password" required minLength={state.screen === "signin" ? undefined : 12} autoComplete={state.screen === "signin" ? "current-password" : "new-password"} /></label>}
        {twoFactor && <label>{state.screen === "backup" ? "恢复码" : "验证码"}<input name="code" required autoComplete="one-time-code" inputMode={state.screen === "totp" ? "numeric" : "text"} pattern={state.screen === "totp" ? "[0-9]{6}" : undefined} /></label>}
        <button className="primary full" disabled={busy}>{busy ? "处理中…" : verification ? "重新发送验证邮件" : twoFactor ? "验证并登录" : state.screen === "signup" ? "注册" : state.screen === "forgot" ? "发送重置邮件" : state.screen === "reset" ? "更新密码" : "登录"}</button>
      </fieldset>
    </form>}
    {twoFactor && <button disabled={busy} onClick={() => dispatch({ type: "screen", screen: state.screen === "totp" ? "backup" : "totp" })}>{state.screen === "totp" ? "使用恢复码" : "使用验证器"}</button>}
    {github && ["signin", "signup"].includes(state.screen) && <button className="full" disabled={busy} onClick={() => void run(async () => { check(await auth.signIn.social({ provider: "github", callbackURL: `${location.origin}/app` })); })}>使用 GitHub 登录</button>}
    <div className="auth-links">
      {state.screen !== "signin" && <button disabled={busy} onClick={() => go("signin")}>返回登录</button>}
      {state.screen === "signin" && <button disabled={busy} onClick={() => go("signup")}>创建账号</button>}
      <button disabled={busy} onClick={() => go("forgot")}>忘记密码</button>
    </div>
  </section><footer>SM · 统一身份与服务</footer></main>;
}
