from playwright.sync_api import sync_playwright
import os
import time

def run():
    cwd = os.getcwd()
    file_path = f"file://{cwd}/index.html"
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # Capture console logs
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))
        
        print(f"Navigating to {file_path}")
        page.goto(file_path)
        
        # Check initial state
        game_state = page.evaluate("window.gameState")
        print(f"Initial GameState: {game_state}")
        
        # Click Start Button
        print("Clicking Start Game...")
        page.locator("#startBtn").click()
        time.sleep(1)
        
        # Check state after start
        game_state = page.evaluate("window.gameState")
        print(f"GameState after Start: {game_state}")
        
        # Check if overlay is hidden
        overlay_class = page.locator("#gameOverlay").get_attribute("class")
        print(f"Overlay class: {overlay_class}")
        
        browser.close()

if __name__ == "__main__":
    run()
