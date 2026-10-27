// Splash Screen Handler
(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', function() {
        const splashScreen = document.getElementById('splash-screen');
        const pageWrapper = document.querySelector('.page-wrapper');
        const skipButton = document.getElementById('skip-splash-btn');
        const INTRO_DURATION = 11000;

        if (!splashScreen || !pageWrapper) {
            return;
        }

        // Build the typewriter lines: "white part|yellow part", one span per character
        document.querySelectorAll('#splash-scene [data-type]').forEach(function(line) {
            const parts = line.dataset.type.split('|');
            const start = parseFloat(line.dataset.start) || 0;
            const isDark = !!line.closest('.sp-text-dark');
            const step = isDark ? 0.07 : 0.1;
            let i = 0;
            parts.forEach(function(part, p) {
                Array.from(part).forEach(function(c) {
                    const s = document.createElement('span');
                    s.className = 'ch' + (p === 1 ? ' y' : '');
                    s.textContent = c;
                    s.style.animationDelay = (start + i++ * step) + 's';
                    line.appendChild(s);
                });
            });
        });

        // Check if splash screen has already been shown in this session
        const hasSeenSplash = sessionStorage.getItem('splashScreenShown');

        // Function to end splash screen
        function endSplashScreen() {
            splashScreen.classList.add('fade-out');
            pageWrapper.classList.add('show');
            
            // Mark splash screen as shown for this session
            sessionStorage.setItem('splashScreenShown', 'true');
            
            // Remove splash screen from DOM after fade out
            setTimeout(function() {
                splashScreen.style.display = 'none';
            }, 500);
        }

        // If user has already seen splash in this session, skip it
        if (hasSeenSplash) {
            splashScreen.style.display = 'none';
            pageWrapper.classList.add('show');
            return;
        }

        // End splash screen when the intro animation finishes
        setTimeout(endSplashScreen, INTRO_DURATION);

        // Skip button click handler
        if (skipButton) {
            skipButton.addEventListener('click', function(e) {
                e.stopPropagation();
                endSplashScreen();
            });
        }

        // Optional: Skip splash on screen click (excluding button)
        splashScreen.addEventListener('click', function(e) {
            if (e.target !== skipButton) {
                endSplashScreen();
            }
        });

    });
})();
