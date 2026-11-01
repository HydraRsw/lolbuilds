//go:build !windows

package main

const overlaySupported = false

func runOverlay(url, kind string) {}

func startHotkeys(cb func(id int)) func() { return func() {} }
