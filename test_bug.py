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
        
        # Start game check
        game_state = page.evaluate("window.gameState")
        assert game_state['running'] == True
        print("✅ Initial game state verified.")

        # TEST BUG FIX: Rapid movement
        # Initial velocity is (1, 0) [Right]
        # We press Down (0, 1) then Left (-1, 0) very quickly.
        # Without fix, this would cause 180 turn from Right to Left if updates are slow.
        # With fix, queue handles it: Right -> Down -> Left.
        
        # Press Down
        page.keyboard.press("ArrowDown")
        # Press Left immediately
        page.keyboard.press("ArrowLeft")
        
        # Wait a bit for moves to process
        time.sleep(1)
        
        game_state_after = page.evaluate("window.gameState")
        
        # If bug exists, gameOver would be True due to self-collision
        assert game_state_after['gameOver'] == False
        assert game_state_after['running'] == True
        print("✅ Rapid input test passed (No self-collision).")
        
        browser.close()

if __name__ == "__main__":
    run()
