"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  PASSWORD_MIN_LENGTH,
  PERMISSIONS,
  ROLE_LABELS,
  type Permission,
  type PublicUser,
  type UserRole,
} from "@/lib/auth/user-shared";

// 使用者設定（只限管理者）：新增、修改、刪除使用者的帳號、密碼、角色與可用功能，存在 MongoDB carpark.user

interface Draft {
  id: string | null;
  username: string;
  name: string;
  password: string;
  role: UserRole;
  permissions: Permission[];
}

const emptyDraft = (): Draft => ({ id: null, username: "", name: "", password: "", role: "user", permissions: [] });

const buttonClass = "rounded px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50";

export function UserSettings({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const json = (await (await fetch("/api/users")).json()) as { ok: boolean; error?: string; users?: PublicUser[] };
      if (json.ok) setUsers(json.users ?? []);
      else setMessage({ ok: false, text: json.error ?? "讀取失敗" });
    } catch {
      setMessage({ ok: false, text: "連不到伺服器" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 進入頁面讀一次；setState 都在 await 之後
    load();
  }, [load]);

  const send = async (method: "POST" | "PUT" | "DELETE", id: string | null, body?: object, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/users${id ? `?id=${id}` : ""}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json()) as { ok: boolean; error?: string; users?: PublicUser[] };
      if (json.ok) {
        setUsers(json.users ?? []);
        setDraft(null);
        setMessage({ ok: true, text: done ?? "已儲存" });
      } else {
        setMessage({ ok: false, text: json.error ?? "儲存失敗" });
      }
    } catch {
      setMessage({ ok: false, text: "連不到伺服器" });
    } finally {
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const { id, ...body } = draft;
    send(id ? "PUT" : "POST", id, body, id ? `已修改 ${draft.username}` : `已新增 ${draft.username}`);
  };

  const remove = (user: PublicUser) => {
    if (window.confirm(`確定刪除使用者「${user.username}」？`)) send("DELETE", user.id, undefined, `已刪除 ${user.username}`);
  };

  const edit = (user: PublicUser) =>
    setDraft({ id: user.id, username: user.username, name: user.name, password: "", role: user.role, permissions: user.permissions });

  const togglePermission = (id: Permission) =>
    draft &&
    setDraft({
      ...draft,
      permissions: draft.permissions.includes(id) ? draft.permissions.filter((p) => p !== id) : [...draft.permissions, id],
    });

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-gray-900">使用者設定</h2>
        <button type="button" onClick={() => setDraft(emptyDraft())} disabled={busy} className={`${buttonClass} bg-[#428bca] hover:bg-[#3071a9]`}>
          新增使用者
        </button>
      </div>
      <p className="text-gray-500">管理者可以使用所有功能並管理使用者；一般使用者只會看到勾選的功能。登入狀態保留 180 分鐘。</p>

      {draft && (
        <form onSubmit={save} className="space-y-3 rounded border border-gray-200 bg-gray-50 p-4">
          <div className="font-medium">{draft.id ? `修改使用者：${draft.username}` : "新增使用者"}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              帳號
              <input
                value={draft.username}
                onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                required
                autoComplete="off"
                className="rounded border border-gray-300 bg-white px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1">
              姓名
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                maxLength={40}
                className="rounded border border-gray-300 bg-white px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1">
              {draft.id ? "新密碼（留空表示不修改）" : "密碼"}
              <input
                type="password"
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                required={!draft.id}
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
                className="rounded border border-gray-300 bg-white px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1">
              角色
              <select
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as UserRole })}
                className="rounded border border-gray-300 bg-white px-2 py-1.5"
              >
                <option value="user">{ROLE_LABELS.user}</option>
                <option value="admin">{ROLE_LABELS.admin}</option>
              </select>
            </label>
          </div>
          <fieldset className="space-y-1">
            <legend className="mb-1">可使用的功能{draft.role === "admin" && "（管理者全部都可以使用）"}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {PERMISSIONS.map((p) => (
                <label key={p.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={draft.role === "admin" || draft.permissions.includes(p.id)}
                    disabled={draft.role === "admin"}
                    onChange={() => togglePermission(p.id)}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={`${buttonClass} bg-green-600 hover:bg-green-700`}>
              儲存
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 hover:bg-gray-100"
            >
              取消
            </button>
          </div>
        </form>
      )}

      {message && <div className={message.ok ? "text-green-700" : "text-red-600"}>{message.text}</div>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="border border-gray-200 px-2 py-1.5">帳號</th>
              <th className="border border-gray-200 px-2 py-1.5">姓名</th>
              <th className="border border-gray-200 px-2 py-1.5">角色</th>
              <th className="border border-gray-200 px-2 py-1.5">可使用的功能</th>
              <th className="border border-gray-200 px-2 py-1.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className="border border-gray-200 px-2 py-1.5">
                  {user.username}
                  {user.id === currentUserId && <span className="ml-1 text-xs text-gray-500">（目前登入）</span>}
                </td>
                <td className="border border-gray-200 px-2 py-1.5">{user.name}</td>
                <td className="border border-gray-200 px-2 py-1.5">{ROLE_LABELS[user.role]}</td>
                <td className="border border-gray-200 px-2 py-1.5">
                  {user.role === "admin"
                    ? "全部"
                    : PERMISSIONS.filter((p) => user.permissions.includes(p.id))
                        .map((p) => p.label)
                        .join("、") || "（無）"}
                </td>
                <td className="border border-gray-200 px-2 py-1.5 whitespace-nowrap">
                  <button type="button" onClick={() => edit(user)} disabled={busy} className={`${buttonClass} mr-2 bg-sky-500 hover:bg-sky-600`}>
                    編輯
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(user)}
                    disabled={busy || user.id === currentUserId}
                    className={`${buttonClass} bg-red-500 hover:bg-red-600`}
                  >
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
