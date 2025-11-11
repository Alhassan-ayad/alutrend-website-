// Splash Screen Handler
(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', function() {
        const splashScreen = document.getElementById('splash-screen');
        const splashVideo = document.getElementById('splash-video');
        const pageWrapper = document.querySelector('.page-wrapper');
        const skipButton = document.getElementById('skip-splash-btn');

        if (!splashScreen || !splashVideo || !pageWrapper) {
            return;
        }

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

        // End splash screen when video ends
        splashVideo.addEventListener('ended', endSplashScreen);

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

        // Fallback: If video fails to load or takes too long
        setTimeout(function() {
            if (splashScreen.style.display !== 'none') {
                endSplashScreen();
            }
        }, 10000); // 10 seconds max

        // Handle video load error
        splashVideo.addEventListener('error', function() {
            console.log('Video failed to load, skipping splash screen');
            endSplashScreen();
        });
    });
})();
