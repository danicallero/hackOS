Pod::Spec.new do |s|
  s.name = 'FilePreview'
  s.version = '0.1.0'
  s.summary = 'Quick Look preview for downloaded files'
  s.description = 'Presents a local file in QLPreviewController and resolves when it closes.'
  s.author = 'hackOS'
  s.homepage = 'https://github.com/danicallero/hackOS'
  s.platforms = { :ios => '16.4' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{swift,h,m,mm}'
end
