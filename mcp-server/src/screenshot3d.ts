import { chromium, Browser, Page } from 'playwright-core';
import path from 'path';
import fs from 'fs';

export class Screenshot3D {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private viewerUrl: string;
  
  constructor(viewerUrl: string = 'http://localhost:3007') {
    this.viewerUrl = viewerUrl;
  }
  
  /**
   * Initialize the browser and page
   */
  async initialize(): Promise<void> {
    if (this.browser) return;
    
    // Try to find Chrome/Chromium executable
    const possiblePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      process.env.CHROME_PATH,
    ].filter(Boolean) as string[];
    
    let executablePath: string | undefined;
    for (const chromePath of possiblePaths) {
      if (fs.existsSync(chromePath)) {
        executablePath = chromePath;
        console.error(`Found browser at: ${chromePath}`);
        break;
      }
    }
    
    if (!executablePath) {
      throw new Error('No Chrome/Chromium browser found. Please install Chrome or set CHROME_PATH environment variable.');
    }
    
    try {
      this.browser = await chromium.launch({
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--ignore-gpu-blocklist',
          '--use-angle=metal',  // Use Metal on macOS for proper GPU acceleration
        ]
      });
      
      this.page = await this.browser.newPage();
      
      // Set a reasonable viewport size
      await this.page.setViewportSize({ width: 1280, height: 720 });
      
      // Navigate to the viewer
      await this.page.goto(this.viewerUrl, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      
      // Wait a bit for the 3D scene to render
      await this.page.waitForTimeout(3000);
      
      console.error('3D screenshot browser initialized successfully');
    } catch (error) {
      console.error('Failed to initialize browser:', error);
      throw error;
    }
  }
  
  /**
   * Capture a 3D screenshot from the prismarine-viewer
   */
  async capture(): Promise<string> {
    if (!this.page) {
      await this.initialize();
    }
    
    if (!this.page) {
      throw new Error('Failed to initialize browser page');
    }
    
    try {
      // Make sure we're still on the viewer page
      const currentUrl = this.page.url();
      if (!currentUrl.includes('localhost:3007')) {
        await this.page.goto(this.viewerUrl, { 
          waitUntil: 'networkidle',
          timeout: 30000 
        });
        await this.page.waitForTimeout(2000);
      }
      
      // Take the screenshot
      const screenshot = await this.page.screenshot({
        type: 'jpeg',
        quality: 90,
        fullPage: false
      });
      
      // Convert to base64
      return screenshot.toString('base64');
    } catch (error) {
      console.error('Failed to capture 3D screenshot:', error);
      // Try to reinitialize on error
      await this.cleanup();
      await this.initialize();
      throw error;
    }
  }
  
  /**
   * Clean up browser resources
   */
  async cleanup(): Promise<void> {
    if (this.page) {
      try {
        await this.page.close();
      } catch (e) {
        // Ignore close errors
      }
      this.page = null;
    }
    
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {
        // Ignore close errors
      }
      this.browser = null;
    }
  }
  
  /**
   * Check if the viewer is accessible
   */
  async checkViewerStatus(): Promise<boolean> {
    try {
      const response = await fetch(this.viewerUrl);
      return response.ok;
    } catch (error) {
      console.error('Viewer not accessible:', error);
      return false;
    }
  }
}