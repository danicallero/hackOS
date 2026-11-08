Pod::Spec.new do |s|
  s.name = 'ScrollEdgeContainer'
  s.version = '0.1.0'
  s.summary = 'Native scroll edge protection for pinned schedule dates'
  s.description = 'Connects UIKit scroll edge effects to custom overlay containers.'
  s.author = 'hackOS'
  s.homepage = 'https://github.com/danicallero/hackOS'
  s.platforms = { :ios => '16.4' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{swift,h,m,mm}'
end
