import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { bookingByToken, hostById, publicHost, publicType, type CalEventType } from "@/lib/cal";
import { ManageView } from "./ManageView";
import s from "../../ui.module.css";

export const dynamic = "force-dynamic";

/** /b/<token>: the guest's link from the invite - see, move or cancel the booking. */
export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const svc = db();
  const booking = await bookingByToken(svc, token);
  if (!booking) notFound();
  const host = await hostById(svc, booking.host_id);
  if (!host) notFound();
  const { data: type } = booking.event_type_id ? await svc.from("cal_event_types").select("*").eq("id", booking.event_type_id).maybeSingle() : { data: null };
  return (
    <main className={`${s.wrap}`}>
      <ManageView
        token={token}
        host={publicHost(host)}
        type={type ? publicType(type as CalEventType, host) : null}
        booking={{
          event: booking.event_name,
          start: booking.start_at,
          status: booking.status,
          past: Date.parse(booking.end_at) < Date.now(),
          meet_url: booking.status === "confirmed" ? booking.meet_url : null,
        }}
      />
    </main>
  );
}
