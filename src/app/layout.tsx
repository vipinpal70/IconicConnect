import "rsuite/dist/rsuite-no-reset.min.css";
import "./globals.css";
import { Providers } from "./providers";

import { Toaster } from "sonner";

export const metadata = {
  title: "Iconic Connect",
  description: "Advanced Dental Solutions",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          {children}
          <Toaster position="top-right" richColors />
        </Providers>
      </body>
    </html>
  );
}
