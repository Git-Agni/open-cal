import s from "./ui.module.css";

export default function NotFound() {
  return (
    <main className={`${s.wrap} ${s.narrow}`}>
      <div className={`${s.card} ${s.done}`}>
        <div className={s.eyebrow}>Not found</div>
        <h2 className={s.title}>This booking page does not exist.</h2>
        <p className={s.sub}>Check the link, or ask for a new one.</p>
      </div>
    </main>
  );
}
