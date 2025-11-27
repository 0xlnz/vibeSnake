from playwright.sync_api import sync_playwright
import os

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
        
        # Check if window.gameState is defined
        game_state = page.evaluate("window.gameState")
        print(f"GameState: {game_state}")
        
        browser.close()

if __name__ == "__main__":
    run()
