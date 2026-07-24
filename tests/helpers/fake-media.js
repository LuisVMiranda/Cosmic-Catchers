export class FakeMediaTrack extends EventTarget {
  constructor({ duration = 3 } = {}) {
    super();
    this.autoplay = false;
    this.currentTime = 0;
    this.duration = duration;
    this.ended = false;
    this.loop = false;
    this.muted = false;
    this.paused = true;
    this.preload = "auto";
    this.volume = 1;
    this.playCount = 0;
    this.pauseCount = 0;
  }

  play() {
    this.ended = false;
    this.paused = false;
    this.playCount += 1;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.pauseCount += 1;
  }

  finish() {
    this.ended = true;
    this.paused = true;
    this.dispatchEvent(new Event("ended"));
  }
}

export function createFakeAudioElements() {
  return {
    menu: new FakeMediaTrack({ duration: 191 }),
    game: new FakeMediaTrack({ duration: 144 }),
    resume: new FakeMediaTrack({ duration: 2 }),
    gameOver: new FakeMediaTrack({ duration: 3 }),
    winning: new FakeMediaTrack({ duration: 4 }),
    collect: [new FakeMediaTrack({ duration: 1 }), new FakeMediaTrack({ duration: 1 })]
  };
}

