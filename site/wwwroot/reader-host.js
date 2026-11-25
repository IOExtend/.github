import { threaded } from './reader-profile.js';

if (threaded) {
  // .NET 10 must treat this dedicated worker as the host of its own pthread pool.
  self.importScripts = undefined;
  self.window = self;
}
