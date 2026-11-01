//go:build !windows

package main

const overlaySupported = false

func runOverlay(url string) {}
