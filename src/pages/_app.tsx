// src/pages/_app.tsx
import type { AppProps } from 'next/app';
import '../styles/globals.css';
import '../styles/registration.css';
import '../styles/admin.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
