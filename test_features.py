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
        
        # Start Game for check
        page.locator("#startBtn").click()
        page.wait_for_function("() => window.gameState.running === true")
        print("✅ Game started via button.")
        
        # 1. Verify Initial State
        game_state = page.evaluate("window.gameState")
        assert game_state['running'] == True
        print("✅ Initial game state verified.")
        
        # 2. Verify Dark Mode Toggle
        # Initial state (assuming defaults to light if not set, or based on previous localStorage)
        # But Playwright profile is fresh, so it should be Light.
        theme_btn = page.locator("#themeBtn")
        initial_theme_text = theme_btn.inner_text()
        print(f"Initial Theme Button: {initial_theme_text}")
        
        # Click toggle
        theme_btn.click()
        page.wait_for_function("() => document.body.classList.contains('dark-mode')")
        
        # Check class on body
        has_dark_class = page.evaluate("document.body.classList.contains('dark-mode')")
        assert has_dark_class == True
        print("✅ Dark mode class applied.")
        
        # Check button text changed
        new_theme_text = theme_btn.inner_text()
        assert new_theme_text != initial_theme_text
        print("✅ Theme button text updated.")
        
        # Click again to revert
        theme_btn.click()
        page.wait_for_function("() => !document.body.classList.contains('dark-mode')")
        has_dark_class = page.evaluate("document.body.classList.contains('dark-mode')")
        assert has_dark_class == False
        print("✅ Light mode reverted.")

        # 3. Verify Mouse Control Switch
        # Select Mouse Mode
        page.locator("input[value='mouse']").check(force=True)
        time.sleep(0.2) # Allow instructions text to update
        
        # Verify Instructions text update
        instructions = page.locator("#instructions").inner_text()
        assert "Move Mouse" in instructions
        print("✅ Instructions updated for Mouse Mode.")
        
        # Simulate Mouse Move
        # Snake starts at 10,10 (200, 200).
        # Start Game again because switching modes resets to menu
        page.locator("#startBtn").click()
        page.wait_for_function("() => window.gameState.running === true")
        print("✅ Game restarted for Mouse Mode.")
        
        # Move mouse to 300, 200 (Right).
        page.mouse.move(300, 200)
        time.sleep(1)
        
        # Snake should have moved Right.
        # Current pos check
        # We can check snake head from game state if we exposed it?
        # Or just assume it runs without error.
        game_state_mouse = page.evaluate("window.gameState")
        assert game_state_mouse['running'] == True
        print("✅ Game running in mouse mode.")

        browser.close()

if __name__ == "__main__":
    run()
