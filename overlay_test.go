package main

import (
	"net/http/httptest"
	"testing"
)

func TestOverlayHotkeysAndClose(t *testing.T) {
	o := &overlayMgr{state: overlayState{Visible: true, Pin: "deck1"}}
	// ✕ on the recipe bar hides only the bar and keeps the pinned comp
	o.handleState(httptest.NewRecorder(), httptest.NewRequest("POST", "/api/overlay/state?recipes=hide", nil))
	if !o.state.RecipesHidden || !o.state.Visible || o.state.Pin != "deck1" {
		t.Fatalf("after ✕: %+v", o.state)
	}
	o.hotkey(3) // Ctrl+Shift+C brings the bar back
	if o.state.RecipesHidden {
		t.Fatalf("Ctrl+Shift+C should show the bar: %+v", o.state)
	}
	o.hotkey(3) // and hides it again
	if !o.state.RecipesHidden {
		t.Fatalf("Ctrl+Shift+C should hide the bar: %+v", o.state)
	}
	o.hotkey(1) // Ctrl+Shift+X hides everything
	o.hotkey(1) // ...and showing again brings both windows back
	if !o.state.Visible || o.state.RecipesHidden {
		t.Fatalf("Ctrl+Shift+X should show both: %+v", o.state)
	}
	o.hotkey(1)
	o.hotkey(3) // Ctrl+Shift+C while all hidden shows the overlay with the bar
	if !o.state.Visible || o.state.RecipesHidden {
		t.Fatalf("Ctrl+Shift+C from hidden: %+v", o.state)
	}
	// posting the pin does not touch the bar state
	o.handleState(httptest.NewRecorder(), httptest.NewRequest("POST", "/api/overlay/state?pin=", nil))
	if o.state.Pin != "" || o.state.RecipesHidden {
		t.Fatalf("pin post: %+v", o.state)
	}
}
