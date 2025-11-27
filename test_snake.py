from playwright.sync_api import sync_playwright
import os
import time

def run():
    cwd = os.getcwd()
    file_path = f"file://{cwd}/index.html"
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        print(f"Navigating to {file_path}")
        page.goto(file_path)
        
        # 1. Start Game
        # Game no longer auto-starts. Need to click Start.
        start_btn = page.locator("#startBtn")
        if start_btn.is_visible():
            start_btn.click()
            page.wait_for_function("() => window.gameState.running === true")
            print("✅ Game started via button.")
        
        # 2. Verify Title
        title = page.title()
        assert "Cute Snake Game" in title
        print("✅ Title verified.")
        
        # 2. Verify Initial Score
        score_text = page.locator("#score").inner_text()
        assert score_text == "0"
        print("✅ Initial score verified.")
        
        # 3. Check Game State
        game_state = page.evaluate("window.gameState")
        assert game_state['running'] == True
        assert game_state['score'] == 0
        print("✅ Initial game state verified.")

        # 3.5 Test Pause
        # Ensure game has focus/running
        page.locator("#gameCanvas").click() # Focus canvas
        page.keyboard.press("Space")
        time.sleep(0.5)
        game_state_paused = page.evaluate("window.gameState")
        assert game_state_paused['paused'] == True
        print("✅ Game paused.")
        
        time.sleep(0.5) # Wait to ensure no movement/updates happened
        # Resume
        page.keyboard.press("Space")
        time.sleep(0.2)
        game_state_resumed = page.evaluate("window.gameState")
        assert game_state_resumed['paused'] == False
        print("✅ Game resumed.")
        
        # 4. Play a bit 
        # Move right is default.
        time.sleep(1)
        
        game_state_after = page.evaluate("window.gameState")
        assert game_state_after['running'] == True
        print("✅ Game running after start.")
        print("✅ Game continues to run as expected (no wall collision game over).")

        browser.close()

if __name__ == "__main__":
    run()
