import { watch } from 'chokidar';
import path from 'path';
import { EventEmitter } from 'events';

export class FileWatcher extends EventEmitter {
    private watcher: ReturnType<typeof watch> | null = null;

    start(rootPath: string) {
        this.stop();

        console.log(`Starting watcher on: ${rootPath}`);
        this.watcher = watch(rootPath, {
            ignored: /(^|[\/\\])\../, 
            persistent: true,
            awaitWriteFinish: {
                stabilityThreshold: 2000,
                pollInterval: 100
            }
        });

        this.watcher
            .on('add', (filePath: string) => {
                 if (path.extname(filePath).toLowerCase() === '.pdf') {
                     this.emit('add', filePath);
                 }
            })
            .on('unlink', (filePath: string) => {
                 if (path.extname(filePath).toLowerCase() === '.pdf') {
                     this.emit('unlink', filePath);
                 }
            });
    }

    stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }
}
