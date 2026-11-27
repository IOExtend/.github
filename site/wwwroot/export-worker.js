import { dotnet } from './model-export/_framework/dotnet.js';
import { runOperation } from './operation-worker.js';

self.onmessage = ({ data }) => runOperation(dotnet, data);
