import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

const qc = new QueryClient({
    defaultOptions: {
        queries: {
            // The WebSocket is the source of live updates; we only refetch
            // when the user navigates back to a page or the WS sends an
            // explicit invalidate. No noisy interval polling.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
        },
    },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');
ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
        <QueryClientProvider client={qc}>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </QueryClientProvider>
    </React.StrictMode>,
);
