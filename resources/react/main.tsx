import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import 'katex/dist/katex.min.css';
import './style.css';

const root = document.getElementById('helm-react');
if (root) createRoot(root).render(<App bootstrap={JSON.parse(root.dataset.bootstrap || '{}')} />);
