/**
 * Typing Animation Effect
 * Animates text to appear as if being typed letter by letter
 */

function typeText(element, text, speed, callback) {
    let i = 0;
    element.textContent = '';
    element.classList.add('typing');
    
    function typeChar() {
        if (i < text.length) {
            element.textContent += text.charAt(i);
            i++;
            setTimeout(typeChar, speed);
        } else {
            if (callback) {
                callback();
            }
        }
    }
    
    typeChar();
}

function startTypingAnimation() {
    const embraceElement = document.querySelector('.upper-big');
    const simplicityElement = document.querySelector('.lower-big');
    const slideWords = document.querySelectorAll('.slide-word');
    
    if (embraceElement && simplicityElement) {
        // Store original text
        const embraceText = embraceElement.textContent;
        const simplicityText = simplicityElement.textContent;
        
        // Add typing-text class
        embraceElement.classList.add('typing-text');
        simplicityElement.classList.add('typing-text');
        
        // Start typing animation with a small delay
        setTimeout(function() {
            // Type "Embrace" first (120ms per character for smoother effect)
            typeText(embraceElement, embraceText, 120, function() {
                // After "Embrace" is done, type "Simplicity" (120ms per character)
                setTimeout(function() {
                    typeText(simplicityElement, simplicityText, 120, function() {
                        // After "Simplicity" is done, slide in each word one by one
                        if (slideWords.length > 0) {
                            let delay = 300; // Initial delay before first word
                            slideWords.forEach(function(word, index) {
                                setTimeout(function() {
                                    word.classList.add('slide-in');
                                }, delay + (index * 400)); // 400ms between each word
                            });
                        }
                    });
                }, 400); // Pause between words
            });
        }, 800); // Delay after splash screen ends
    }
}

// Initialize typing animation when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Check if splash screen has been shown
    const hasSeenSplash = sessionStorage.getItem('splashScreenShown');
    
    if (hasSeenSplash) {
        // If splash was already shown, start typing immediately
        startTypingAnimation();
    } else {
        // Wait for splash screen to end before starting typing
        const splashScreen = document.getElementById('splash-screen');
        
        if (splashScreen) {
            // Create observer to watch for splash screen removal/hiding
            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.target.classList.contains('fade-out') || 
                        mutation.target.style.display === 'none') {
                        startTypingAnimation();
                        observer.disconnect();
                    }
                });
            });
            
            // Observe splash screen for changes
            observer.observe(splashScreen, {
                attributes: true,
                attributeFilter: ['class', 'style']
            });
            
            // Fallback: Start typing if splash screen doesn't exist or takes too long
            setTimeout(function() {
                if (!document.querySelector('.upper-big').classList.contains('typing')) {
                    startTypingAnimation();
                    observer.disconnect();
                }
            }, 12000);
        } else {
            // No splash screen found, start typing immediately
            startTypingAnimation();
        }
    }
});
