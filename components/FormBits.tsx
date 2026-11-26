import { useId } from "react";

// Small pieces the forms share: a picture in front of each section's name.
const PATHS = {
  tag: "M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-8.5 8.5a1.5 1.5 0 0 1-2.1 0L3 12zM7.5 7.5h.01",
  clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.3a2.3 2.3 0 1 0 0-4.600 2.300 2.300 0 0 0 0 4.600z",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6M18 14.6a5.5 5.5 0 0 1 3.500 5.400",
  note: "M5 4.5h14v15H5zM8.500 9h7M8.500 12.500h7M8.500 16h4",
  bell: "M6 9.5a6 6 0 0 1 12 0c0 4.5 2 5.5 2 6.5H4c0-1 2-2 2-6.5zM10 19.5a2 2 0 0 0 4 0",
  check: "M4.500 4.500h15v15h-15zM8 12.500l2.800 2.800L16 9.500",
  bank: "M3.500 9.500 12 4.500l8.500 5M5.500 10.500v7M10 10.500v7M14 10.500v7M18.500 10.500v7M3.500 20h17",
  coin: "M8 6.500h8M8 10.500h8M8 6.500h2.500a4 4 0 0 1 0 8H8l6 5.500",
  trend: "M4 17l5.500-5.500 4 4L20 9M15 9h5v5",
  sum: "M17 5.500H7.500l5.500 6.500-5.500 6.500H17",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  eye: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  repeat: "M4 11V9.500a3 3 0 0 1 3-3h12M16 3.500l3 3-3 3M20 13v1.500a3 3 0 0 1-3 3H5M8 20.500l-3-3 3-3",
};

const Pic = ({ icon }: { icon: keyof typeof PATHS }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={PATHS[icon]} /></svg>
);

/** One stop on a form's line: a round mark that fills in once the stop is answered (`set`), its name, and its fields. */
export function Step({ icon, name, set, children }: { icon: keyof typeof PATHS; name: string; set: boolean; children: React.ReactNode }) {
  const id = useId();
  return (
    <section className={`step ${set ? "is-set" : ""}`} aria-labelledby={id}>
      <h3 id={id}><span className="step-mark" aria-hidden><Pic icon={icon} /></span>{name}</h3>
      {children}
    </section>
  );
}

/** A section's name with its picture. Use inside a <legend>, or as the first span of a labelled field. */
export function Named({ icon, children }: { icon: keyof typeof PATHS; children: React.ReactNode }) {
  return (
    <span className="named">
      <Pic icon={icon} />
      {children}
    </span>
  );
}
