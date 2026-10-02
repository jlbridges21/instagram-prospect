import { redirect } from "next/navigation";
import { Logo } from "@/components/layout/logo";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const configured = Boolean(getPublicSupabaseEnv());

  if (configured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/");
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-slate-900 px-10 py-10 text-white lg:flex">
        <div className="inline-flex rounded-xl bg-white px-3 py-2">
          <Logo priority />
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold tracking-tight">Prospecting, organized.</h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            Review qualified prospects, manage outreach, and monitor your local discovery agent from one place.
          </p>
        </div>
        <p className="text-xs text-slate-400">Internal workspace</p>
      </section>
      <section className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="mb-6 lg:hidden">
            <Logo />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-600">Use the account created in Supabase Auth.</p>
          <div className="mt-6">
            {configured ? (
              <LoginForm />
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-950">
                Add <span className="font-medium">NEXT_PUBLIC_SUPABASE_URL</span> and{" "}
                <span className="font-medium">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> to{" "}
                <span className="font-medium">.env.local</span>, then restart the dev server.
              </div>
            )}
          </div>
          <p className="mt-6 text-xs leading-5 text-slate-500">
            Accounts are created by an administrator. This page does not offer public signup.
          </p>
        </div>
      </section>
    </div>
  );
}
