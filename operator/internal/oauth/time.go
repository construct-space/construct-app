package oauth

import "time"

// timeNow is a function variable so tests can mock the clock.
var timeNow = time.Now
