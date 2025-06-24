import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "StudioConnect AI Dashboard",
  description: "Business dashboard for StudioConnect AI",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa' }}>
          {children}
        </div>
      </body>
    </html>
  )
}
