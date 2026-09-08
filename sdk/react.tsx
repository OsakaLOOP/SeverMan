import { useEffect, useState } from "react";

export function useIdentity(base = "") {
  const [user, setUser] = useState<{ id: string; profile: Record<string, unknown> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${base}/auth/me`, { credentials: "include", signal: abort.signal })
      .then(async (response) => { if (response.ok) setUser(await response.json()); else if (response.status !== 401) throw new Error("身份服务暂不可用"); })
      .catch((error) => { if (error.name !== "AbortError") setError(error.message); })
      .finally(() => setLoading(false));
    return () => abort.abort();
  }, [base]);
  return { user, loading, error, login: () => location.assign(`${base}/auth/login`), logout: async () => {
    const response = await fetch(`${base}/auth/logout`, { method: "POST", credentials: "include" });
    if (!response.ok) throw new Error("退出失败");
    setUser(null);
  } };
}

export function LoginButton({ base = "", children = "登录" }: { base?: string; children?: React.ReactNode }) {
  return <button onClick={() => location.assign(`${base}/auth/login`)}>{children}</button>;
}
