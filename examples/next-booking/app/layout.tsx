import type { ReactNode } from "react";

export const metadata = { title: "Salong Demo" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nb">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "2rem auto" }}>
        {children}
      </body>
    </html>
  );
}
