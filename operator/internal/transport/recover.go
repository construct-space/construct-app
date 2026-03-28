package transport

import (
	"fmt"
	"log"
	"runtime/debug"
)

func recoverHandlerPanic(context string, handle func(message string)) {
	if recovered := recover(); recovered != nil {
		message := fmt.Sprintf("handler panic: %v", recovered)
		if context != "" {
			log.Printf("recovered %s: %s\n%s", context, message, debug.Stack())
		} else {
			log.Printf("recovered panic: %s\n%s", message, debug.Stack())
		}
		handle(message)
	}
}
