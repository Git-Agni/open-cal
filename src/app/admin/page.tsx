import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { AdminApp } from "./AdminApp";

export const dynamic = "force-dynamic";
export const metadata = { title: "open-cal admin" };

export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  return <AdminApp />;
}
