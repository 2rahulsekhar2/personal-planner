import type { Metadata, Viewport } from "next";
import "./globals.css";
import Sky from "@/components/Sky";

export const metadata: Metadata = {
  title: "Personal Planner",
  description: "Appointments, tasks and reminders",
  manifest: "/manifest.webmanifest",
  // SVG for browsers that take it, .ico for those that do not; the Apple icon is full-bleed because iOS rounds it itself.
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/favicon.ico", sizes: "48x48" }],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "Planner", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3f8" },
    { media: "(prefers-color-scheme: dark)", color: "#070709" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}` }} />
      </head>
      <body><Sky />{children}</body>
    </html>
  );
}
