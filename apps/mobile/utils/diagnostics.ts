/**
 * Performance diagnostics utilities
 */

export class PerformanceMonitor {
  private renderCount = 0;
  private fetchCount = 0;
  private lastMemoryCheck = 0;
  private fetchTimes: number[] = [];
  private renderTimes: number[] = [];

  logRender(componentName: string) {
    this.renderCount++;
    const now = Date.now();

    // Track render frequency
    if (this.renderTimes.length > 0) {
      const timeSinceLastRender =
        now - this.renderTimes[this.renderTimes.length - 1];
      if (timeSinceLastRender < 100) {
        console.warn(
          `⚠️  RAPID RENDERS: ${componentName} rendered ${this.renderCount} times (${timeSinceLastRender}ms since last)`
        );
      }
    }

    this.renderTimes.push(now);

    // Keep only last 10 render times
    if (this.renderTimes.length > 10) {
      this.renderTimes.shift();
    }

    // Log every 10 renders
    if (this.renderCount % 10 === 0) {
      console.log(`📊 Render count: ${this.renderCount}`);
    }
  }

  logFetch(duration: number, postCount: number) {
    this.fetchCount++;
    this.fetchTimes.push(Date.now());

    console.log(
      `🌐 Fetch #${this.fetchCount}: ${postCount} posts in ${duration}ms`
    );

    // Check for fetch spam
    if (this.fetchTimes.length >= 5) {
      const last5Fetches = this.fetchTimes.slice(-5);
      const timeSpan = last5Fetches[4] - last5Fetches[0];

      if (timeSpan < 5000) {
        console.error(`🚨 FETCH SPAM: 5 fetches in ${timeSpan}ms - TOO FAST!`);
      }
    }

    // Keep only last 20 fetch times
    if (this.fetchTimes.length > 20) {
      this.fetchTimes.shift();
    }
  }

  checkMemory() {
    const now = Date.now();

    // Only check memory every 5 seconds
    if (now - this.lastMemoryCheck < 5000) {
      return;
    }

    this.lastMemoryCheck = now;

    // React Native doesn't expose memory directly, but we can track our state
    console.log(`💾 Performance Stats:`);
    console.log(`   Total renders: ${this.renderCount}`);
    console.log(`   Total fetches: ${this.fetchCount}`);
    console.log(`   Recent fetches: ${this.fetchTimes.length}`);
    console.log(`   Recent renders: ${this.renderTimes.length}`);
  }

  logStateSize(stateName: string, stateValue: any) {
    let size = 0;

    if (Array.isArray(stateValue)) {
      size = stateValue.length;
      console.log(`📦 State: ${stateName} has ${size} items`);

      if (size > 1000) {
        console.warn(
          `⚠️  Large state: ${stateName} has ${size} items - may cause performance issues`
        );
      }
    }
  }

  reset() {
    this.renderCount = 0;
    this.fetchCount = 0;
    this.fetchTimes = [];
    this.renderTimes = [];
    console.log("🔄 Performance monitor reset");
  }
}

export const perfMonitor = new PerformanceMonitor();
