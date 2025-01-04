class Delay {
    readonly totalMs : number;
    readonly startTime : number;

    constructor(totalMs : number) {
        this.totalMs = totalMs;
        this.startTime = Date.now();
    }

    left() {
        const thisTimeout = this;
        const currTime = Date.now();
        const elapsedTime = currTime - this.startTime;
        const timeLeft = this.totalMs - elapsedTime;
        return timeLeft;
    }
}


export class ScheduledJob {

    public readonly name : string;
    public readonly timer : Delay;
    public readonly task: () => Promise<void>;

    constructor(name : string, delay : number, task: () => Promise<void>) {
        this.name = name;
        this.timer = new Delay(delay);
        this.task = task;
    }
}

export class JobQueue {

    private readonly queue : ScheduledJob[] = [];
    private scheduledDequeue : any;
    private smallestDelay: number
    runningJob : ScheduledJob = undefined;

    public insert(name : string, delay : number, task: () => Promise<void>) {
        console.log('INSERTing ' + name);
        let insertIndex;
        for (insertIndex = 0; insertIndex < this.queue.length; insertIndex++) {
            const job = this.queue[insertIndex];
            const jobDelay = job.timer.left();
            if (delay < jobDelay) {
                break;
            }
        }
        this.queue.splice(insertIndex, 0, new ScheduledJob(name, delay, task));
        console.log('queue: ' + this.queue.map(j => j.name));
        if (!this.runningJob) {
            this.scheduleNextDequeue();
        }
    }

    private clearScheduledDequeue() {
        if (this.scheduledDequeue) {
            clearTimeout(this.scheduledDequeue);
            this.scheduledDequeue = undefined;
        }
    }

    private scheduleNextDequeue() {
        console.log('scheduling next dequeue');
        this.clearScheduledDequeue();
        const this_ = this;
        const wrapped = async () => {
            const job = this.queue.shift();
            this_.runningJob = job;
            if (job) {
                //this.clearScheduledDequeue();
                console.log('Dequeued and START executing job : ' + job.name);
                const fnly = () => {
                    console.log('DONE executing job : ' + job.name);
                    this_.runningJob = undefined;
                   // this.queue.shift();
                    this.scheduleNextDequeue();
                };
                fnly.bind(this_);
                await job.task().finally(fnly);
            }
        };
        wrapped.bind(this_);
        if (this.queue.length > 0 ) {
            this.smallestDelay = Math.max(0, this.queue[0].timer.left());
            this.scheduledDequeue = setTimeout(wrapped, this.smallestDelay);
            console.log('scheduled job. queue size: ' + this.queue.length + '. nextDelay: ' + this.smallestDelay);
        }

    }
}

export class JobQueues {

    private readonly object : Object;

    constructor() {
        this.object = new Object();
    }

    public get(key : string) : JobQueue {
        if (this.object[key] === undefined) {
            this.object[key] = new JobQueue();
        }
        return <JobQueue> this.object[key];
    }
}